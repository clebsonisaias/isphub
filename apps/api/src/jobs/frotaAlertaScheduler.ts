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
 * Ha quanto tempo o aparelho precisa estar mudo para o offline valer aviso.
 *
 * A regra nao pode morar na CRIACAO do evento: `derivarEventos` grava
 * `ficou_offline` em toda transicao UP->DOWN, e um rastreador que pisca por um
 * minuto faz isso o dia inteiro. O evento e util no historico do veiculo; o que
 * as 6h decidem e se ele merece interromper alguem.
 */
const OFFLINE_MS = 6 * 60 * 60_000;

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
/*
 * `excesso_velocidade` fica de FORA por decisao de produto: o limite serve para
 * marcar a infracao no historico do veiculo, nao para tocar o sino a cada
 * ultrapassagem. Os quatro abaixo foram os escolhidos.
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
    try {
      await detectarEventosPorDuracao();
    } catch (err) {
      // Detectar e drenar sao independentes: uma falha ao criar o evento de
      // ociosidade nao pode impedir que os alertas JA pendentes saiam.
      console.error("[frota-alerta-scheduler] falha ao detectar eventos por duracao:", err);
    }

    const pendentes = await prisma.eventoRastreador.findMany({
      where: {
        notificadoEm: null,
        tipo: { in: ALERTAVEIS },
        /*
         * A janela olha `criadoEm` (QUANDO GRAVAMOS), e nao `em` (quando o fato
         * aconteceu no aparelho). Os dois divergem de propositio: `em` e ancorado
         * no relogio do dispositivo e pode ser bem anterior. Filtrar por `em`
         * descartaria para sempre justamente os eventos de um aparelho que ficou
         * dias fora — que sao os que mais importam.
         */
        criadoEm: { gte: new Date(Date.now() - JANELA_MAX_MS) },
      },
      // Mais antigo primeiro: com o teto por tique, a fila drena em ordem de
      // chegada em vez de deixar sempre a mesma sobra pra tras.
      orderBy: { criadoEm: "asc" },
      take: MAX_POR_TICK,
      select: {
        id: true,
        tipo: true,
        detalhe: true,
        veiculo: { select: { placa: true } },
        rastreador: { select: { comunicando: true, ultimaPosicaoEm: true } },
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

    const agora = Date.now();
    for (const ev of pendentes) {
      /*
       * A REGRA DAS 6H, aplicada aqui e nao na criacao.
       *
       * O evento nasce na transicao UP->DOWN, que acontece a cada piscada. Aqui
       * a pergunta e outra: o aparelho CONTINUA mudo, e ha tempo suficiente? Se
       * ja voltou, o apagao foi um susto e nao vale o sino — mas o evento fica
       * carimbado como notificado, para nao ser reavaliado para sempre.
       */
      if (ev.tipo === "ficou_offline") {
        const ultima = ev.rastreador.ultimaPosicaoEm?.getTime() ?? 0;
        const aindaMudo = ev.rastreador.comunicando === false && agora - ultima >= OFFLINE_MS;
        if (!aindaMudo) {
          await prisma.eventoRastreador.updateMany({
            where: { id: ev.id, notificadoEm: null },
            data: { notificadoEm: new Date() },
          });
          continue;
        }
      }

      const texto = mensagem(ev.tipo, ev.veiculo?.placa ?? null, ev.detalhe);
      /*
       * Trava e notificacao na MESMA transacao, e a trava e um COMPARE-AND-SWAP.
       *
       * `updateMany` com `notificadoEm: null` no WHERE, em vez de `update` por
       * id: com duas replicas, as duas leem o mesmo evento pendente e as duas
       * chegariam aqui. Quem perde a corrida encontra `count === 0` e desiste —
       * sem isso, o gestor recebe o mesmo aviso duas vezes.
       *
       * Separar as duas escritas significaria, nas palavras do proprio schema,
       * "ou repete o aviso pra sempre, ou perde o aviso pra sempre".
       */
      await prisma.$transaction(async (tx) => {
        const trava = await tx.eventoRastreador.updateMany({
          where: { id: ev.id, notificadoEm: null },
          data: { notificadoEm: new Date() },
        });
        if (trava.count === 0) return;
        await tx.notificacao.createMany({
          data: gestores.map((g) => ({ usuarioId: g.id, tipo: "frota_alerta", mensagem: texto })),
        });
      });
    }
  } catch (err) {
    console.error("[frota-alerta-scheduler] falha no tick:", err);
  } finally {
    tickEmAndamento = false;
  }
}

/** Exposto so pro teste — mesmo padrao de `osNovaAlertScheduler`. */
export const __tickParaTeste = tick;

export function startFrotaAlertaScheduler() {
  cron.schedule("*/5 * * * *", () => {
    void tick();
  });
  console.log("[frota-alerta-scheduler] ativo (alertas de frota a cada 5 min)");
}
