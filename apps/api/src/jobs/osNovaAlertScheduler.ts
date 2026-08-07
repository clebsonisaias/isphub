import cron from "node-cron";
import { OS_STATUS_ABERTOS, UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { mensagemOsNova } from "../services/osNovaAlertService.js";
import { OS_INTERNA_WHERE } from "../services/equipeService.js";

/**
 * Avisa admin/gestor quando uma OS NOVA entra pelo sync.
 *
 * Job separado, e nao um trecho dentro do syncService, por dois motivos: uma
 * falha ao gravar notificacao nao pode abortar o ciclo de sync (ele aborta
 * inteiro em qualquer excecao), e a trava `novaNotificadaEm` permite retentar
 * no tick seguinte o que falhou — coisa que "avisa no momento do upsert" nao
 * faz, porque na proxima passada a OS ja nao e nova.
 *
 * So OS do PAINEL (`OS_INTERNA_WHERE`). Retirada e a esmagadora maioria — em
 * producao, 707 de 771 abertas num provedor — e vai pra outra tela, tocada por
 * outra equipe. Notificar tudo faria o sino virar quase so retirada e enterrar
 * instalacao e reparo, que e o oposto do pedido. Mesmo criterio que o alerta de
 * SLA ja aplica, pela mesma razao.
 */
let tickEmAndamento = false;

/**
 * Idade maxima pra uma OS ainda valer aviso.
 *
 * Segunda trava, independente da coluna. Se o backfill da migracao falhar (ou
 * alguem restaurar um dump antigo), sem isto o primeiro tick despejaria MIL
 * notificacoes de OS de meses atras em cima de todo admin. O raio do estrago
 * fica limitado a um dia.
 */
const JANELA_MAX_MS = 24 * 60 * 60_000;

/**
 * Teto por tick. Uma importacao grande de OS nao pode virar centenas de linhas
 * no sino de uma vez; o excedente vai nos proximos minutos.
 */
const MAX_POR_TICK = 30;

async function tick() {
  if (tickEmAndamento) return;
  tickEmAndamento = true;
  try {
    const novas = await prisma.ordemServico.findMany({
      where: {
        status: { in: OS_STATUS_ABERTOS },
        novaNotificadaEm: null,
        criadoEm: { gte: new Date(Date.now() - JANELA_MAX_MS) },
        AND: [OS_INTERNA_WHERE],
      },
      // Mais antiga primeiro: com o teto por tick, a fila drena em ordem de
      // chegada em vez de deixar sempre a mesma sobra pra tras.
      orderBy: { criadoEm: "asc" },
      take: MAX_POR_TICK,
      select: {
        id: true,
        sgpOsId: true,
        clienteNome: true,
        tipoOs: { select: { descricao: true } },
      },
    });
    if (novas.length === 0) return;

    const gestores = await prisma.usuario.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
      select: { id: true },
    });
    if (gestores.length === 0) return;

    for (const os of novas) {
      const mensagem = mensagemOsNova({
        clienteNome: os.clienteNome,
        sgpOsId: os.sgpOsId,
        tipoDescricao: os.tipoOs?.descricao ?? null,
      });
      // Trava e notificacoes na MESMA transacao: gravar uma sem a outra ou
      // repete o aviso pra sempre, ou perde o aviso pra sempre.
      await prisma.$transaction([
        prisma.ordemServico.update({
          where: { id: os.id },
          data: { novaNotificadaEm: new Date() },
        }),
        prisma.notificacao.createMany({
          data: gestores.map((g) => ({
            usuarioId: g.id,
            tipo: "os_nova",
            mensagem,
            ordemServicoId: os.id,
          })),
        }),
      ]);
    }
    console.log(`[os-nova-alert] ${novas.length} OS nova(s) avisada(s) a ${gestores.length} gestor(es)`);
  } catch (err) {
    console.error("[os-nova-alert] falha no tick:", err);
  } finally {
    tickEmAndamento = false;
  }
}

/** Exposto so pro teste: o cron nao roda em vitest e o tick e o que importa. */
export const __tickParaTeste = tick;

export function startOsNovaAlertScheduler() {
  // A cada minuto, no mesmo ritmo do sync: uma OS que chega tem que aparecer no
  // sino em ate ~1 min, senao o aviso perde a serventia pra quem despacha.
  cron.schedule("* * * * *", () => {
    void tick();
  });
  console.log("[os-nova-alert] ativo (avisa OS nova do Painel a cada minuto)");
}
