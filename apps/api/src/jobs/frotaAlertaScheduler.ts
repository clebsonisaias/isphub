import cron from "node-cron";
import { EVENTO_RASTREADOR_ROTULO, UserRole, formatarPlaca, type EventoRastreadorTipo } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { detectarEventosPorDuracao } from "../services/frotaEventoService.js";

/**
 * O SINO DA FROTA — transforma `EventoRastreador` em `Notificacao`.
 *
 * Job separado da coleta, no mesmo padrao de `slaAlertScheduler` e
 * `osNovaAlertScheduler`, e pelas mesmas duas razoes: falhar ao notificar nao
 * pode abortar a coleta (que e o dado principal), e a trava em COLUNA
 * (`notificadoEm`) permite retentar no tique seguinte o que falhou.
 *
 * O que este job NAO faz, de proposito:
 *
 *   - **nao decide o que e alerta.** Quem decide e `derivarEventos`, na
 *     coleta, e a regra e sempre TRANSICAO: bateria a 12% vira evento quando
 *     cruza pra baixo, nao a cada minuto. Um job que varresse o estado corrente
 *     refaria esse ruido por fora.
 *   - **nao emite SSE.** Nenhum dos dois jobs de alerta emite; o sino e polling
 *     (`GET /notificacoes/contagem`). Acrescentar um tipo de evento aqui
 *     mexeria numa uniao fechada de `@isphub/shared` sem ninguem escutando.
 *   - **nao manda push.** `PushDados` e uma uniao fechada de telas
 *     ("chat" | "chat-clientes" | "os") e nao ha destino de frota. Inventar um
 *     exigiria mexer na navegacao do app.
 */
let tickEmAndamento = false;

/**
 * Idade maxima de um evento para ainda valer aviso.
 *
 * Segunda trava, INDEPENDENTE da coluna. `notificadoEm` nasce nulo em tudo que
 * ja foi gravado antes deste job existir — sem a janela, o primeiro tique
 * despejaria o acervo inteiro de eventos no sino de todo admin. O raio do
 * estrago fica limitado a um dia.
 */
const JANELA_MAX_MS = 24 * 60 * 60_000;

/**
 * Teto por tique. Uma frota que volta do offline gera muitos eventos de uma vez;
 * o excedente vai nos proximos minutos em vez de virar 200 linhas no sino.
 */
const MAX_POR_TICK = 30;

/**
 * Os QUATRO que viram notificacao — nem todo evento merece interromper alguem.
 *
 * `ignicao_ligada`/`desligada` acontecem dezenas de vezes por dia e sao a
 * materia-prima da linha do tempo, nao um aviso. `voltou_online` e
 * `bateria_normalizada` sao boas noticias: aparecem no historico do veiculo,
 * mas nao tocam o sino. Alerta que toca demais e alerta que ninguem le.
 */
const ALERTAVEIS: EventoRastreadorTipo[] = [
  "bateria_baixa",
  "ficou_offline",
  "bloqueio_ativado",
  "parado_com_motor_ligado",
];

/** "Bateria fraca: HFX-3652 (12%)" — uma linha, sem emoji, com a placa. */
function mensagem(
  tipo: EventoRastreadorTipo,
  placa: string | null,
  detalhe: unknown,
): string {
  const rotulo = EVENTO_RASTREADOR_ROTULO[tipo];
  /*
   * `Notificacao` nao tem `veiculoId` — so `ordemServicoId`. A identificacao do
   * veiculo vai no TEXTO, como as outras notificacoes fazem com o nome do
   * cliente. Sem placa, o texto ainda diz o que houve em vez de ficar anonimo.
   */
  const quem = placa ? formatarPlaca(placa) : "veículo sem placa";
  const d = detalhe && typeof detalhe === "object" ? (detalhe as Record<string, unknown>) : {};

  if (tipo === "bateria_baixa" && typeof d.pct === "number") return `${rotulo}: ${quem} (${d.pct}%)`;
  if (tipo === "parado_com_motor_ligado" && typeof d.minutos === "number") {
    return `${rotulo}: ${quem} (${d.minutos} min)`;
  }
  return `${rotulo}: ${quem}`;
}

async function tick() {
  if (tickEmAndamento) return;
  tickEmAndamento = true;
  try {
    /*
     * Primeiro DETECTAR, depois drenar. Os dois alertas por duracao (offline ha
     * 6h, parado com o motor ligado ha 10 min) nao nascem da coleta — nascem de
     * varrer o estado. Detectar antes faz o que acabou de ser detectado sair no
     * MESMO tique, em vez de esperar mais cinco minutos.
     */
    await detectarEventosPorDuracao();

    const pendentes = await prisma.eventoRastreador.findMany({
      where: {
        notificadoEm: null,
        tipo: { in: ALERTAVEIS },
        em: { gte: new Date(Date.now() - JANELA_MAX_MS) },
      },
      // Mais antigo primeiro: com o teto por tique, a fila drena em ordem de
      // chegada em vez de deixar sempre a mesma sobra pra tras.
      orderBy: { em: "asc" },
      take: MAX_POR_TICK,
      select: {
        id: true,
        tipo: true,
        detalhe: true,
        veiculo: { select: { placa: true } },
      },
    });
    if (pendentes.length === 0) return;

    /*
     * Frota e ADMIN/GESTOR — `/frota/*` inteiro exige um dos dois. Avisar o
     * tecnico sobre a bateria do rastreador seria avisa-lo de algo que ele nao
     * pode ver nem resolver.
     */
    const gestores = await prisma.usuario.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
      select: { id: true },
    });
    // Sem destinatario, NAO carimba: travar aqui engoliria o alerta em silencio
    // e ele nunca mais voltaria.
    if (gestores.length === 0) return;

    for (const ev of pendentes) {
      const texto = mensagem(ev.tipo, ev.veiculo?.placa ?? null, ev.detalhe);
      /*
       * Trava e notificacao na MESMA transacao. Separar significa, nas palavras
       * do proprio schema, "ou repete o aviso pra sempre, ou perde o aviso pra
       * sempre".
       */
      await prisma.$transaction([
        prisma.eventoRastreador.update({ where: { id: ev.id }, data: { notificadoEm: new Date() } }),
        prisma.notificacao.createMany({
          data: gestores.map((g) => ({ usuarioId: g.id, tipo: "frota_alerta", mensagem: texto })),
        }),
      ]);
    }
  } catch (err) {
    console.error("[frota-alerta-scheduler] falha no tick:", err);
  } finally {
    tickEmAndamento = false;
  }
}

export function startFrotaAlertaScheduler() {
  cron.schedule("*/5 * * * *", () => {
    void tick();
  });
  console.log("[frota-alerta-scheduler] ativo (alertas de frota a cada 5 min)");
}
