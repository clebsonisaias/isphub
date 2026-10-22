import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { TURNOS_AGENDA } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireChaveParceiro } from "../middleware/chaveParceiro.js";
import { prisma } from "../lib/prisma.js";
import * as agenda from "../services/agendaService.js";
import { montarOsStatus } from "../lib/osStatusParceiro.js";

/**
 * A porta da AGENDA pra sistemas parceiros — hoje, o AtendAI do provedor.
 *
 * Existe pra fechar o ciclo que a planilha nunca fechou: quem fala com o
 * cliente e o atendimento, mas quem sabe o que cabe na rua e o ISPhub. Sem esta
 * rota, o horario continua sendo combinado num sistema e conferido em outro —
 * que e como se prometia um turno lotado.
 *
 * TRES diferencas em relacao a `/agenda` (a rota interna), e todas de proposito:
 *
 * 1. **O escopo vem da CHAVE, nunca do corpo.** `provedorId` e ignorado se
 *    vier: uma chave pertence a um provedor, e aceitar o id do corpo deixaria
 *    o AtendAI de um provedor marcar na OS de outro por um campo errado.
 * 2. **`/vagas` aqui e `proximas`** — so o que cabe. Quem esta do outro lado
 *    esta oferecendo ao cliente; devolver janela cheia junto seria devolver
 *    uma armadilha.
 * 3. **Rate limit proprio.** E rota publica autenticada por segredo estatico:
 *    sem teto, uma chave vazada vira ferramenta de forca bruta contra a agenda.
 */
export const parceiroAgendaRouter = Router();

/*
 * 120/min por IP. Generoso pro uso real (uma conversa marca uma vez) e apertado
 * pra quem estiver varrendo. Conta ANTES da autenticacao pra tambem limitar
 * tentativa de chave errada.
 */
parceiroAgendaRouter.use(
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }),
);
parceiroAgendaRouter.use(requireChaveParceiro);

/**
 * `GET /vagas` — as proximas janelas que REALMENTE cabem.
 *
 * `regiao` e o bairro/cidade do cliente. Mandar melhora a resposta (o teto
 * regional entra na conta); nao mandar continua funcionando, so sem essa
 * protecao — o AtendAI nem sempre tem o endereco na mao no comeco da conversa.
 */
parceiroAgendaRouter.get(
  "/vagas",
  asyncHandler(async (req, res) => {
    const { regiao, quantas } = z
      .object({
        regiao: z.string().trim().min(1).optional(),
        quantas: z.coerce.number().int().min(1).max(30).default(6),
      })
      .parse(req.query);

    const vagas = await agenda.proximasVagasDoBanco({ regiao, quantas });

    res.json({
      vagas: vagas.map((v) => ({
        dia: v.dia,
        turno: v.turno,
        livres: v.livres,
        // A hora real do inicio, pra quem do outro lado precisa escrever
        // "das 8h ao meio-dia" sem reimplementar essa regra.
        inicioEm: agenda.inicioDoTurno(v.dia, v.turno).toISOString(),
      })),
    });
  }),
);

const marcarSchema = z.object({
  /** Id da OS no SGP — o que o AtendAI acabou de receber ao abrir o chamado. */
  sgpOsId: z.union([z.string().trim().min(1), z.number().int()]).transform(String),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"),
  turno: z.enum(TURNOS_AGENDA),
  regiao: z.string().trim().min(1).nullish(),
  /** "ia" quando o bot fechou sozinho, "humano" quando foi a atendente. */
  por: z.enum(["ia", "humano", "cliente"]).default("humano"),
  /** Nome de quem marcou, pra trilha. A planilha tinha a coluna "Atendente". */
  marcadoPor: z.string().trim().max(120).nullish(),
  observacao: z.string().trim().max(500).nullish(),
});

/** Como a origem chega do outro lado vira a origem canonica daqui. */
const ORIGEM: Record<"ia" | "humano" | "cliente", string> = {
  ia: "atendai_ia",
  humano: "atendai_humano",
  cliente: "cliente",
};

/**
 * `POST /marcar` — marca a visita. 409 quando nao cabe.
 *
 * NAO exige que a OS ja exista no espelho: o AtendAI abre a OS no SGP e chama
 * aqui no mesmo segundo, e o sync so a traz ate ~3 min depois. Ver o comentario
 * do modelo `Agendamento` — e a razao de a chave ser o id do SGP.
 */
parceiroAgendaRouter.post(
  "/marcar",
  asyncHandler(async (req, res) => {
    const b = marcarSchema.parse(req.body);
    const marcado = await agenda.marcar({
      provedorId: req.provedorParceiroId!,
      sgpOsId: b.sgpOsId,
      dia: b.dia,
      turno: b.turno,
      regiao: b.regiao,
      origem: ORIGEM[b.por],
      marcadoPor: b.marcadoPor ?? null,
      observacao: b.observacao ?? null,
    });

    res.status(201).json({
      id: marcado.id,
      dia: b.dia,
      turno: b.turno,
      inicioEm: agenda.inicioDoTurno(b.dia, b.turno).toISOString(),
    });

    /*
     * Write-back DEPOIS da resposta: o AtendAI esta com o cliente na linha, e
     * a confirmacao dele nao pode esperar o SGP do provedor. `sgpConfirmadoEm`
     * conta essa historia no painel do supervisor.
     */
    void agenda.enviarAoSgp(marcado.id);
  }),
);

/**
 * `GET /marcacao/:sgpOsId` — o que esta marcado pra uma OS.
 *
 * E o que permite ao bot responder "sua visita e quinta de manha" sem precisar
 * ter guardado isso na conversa — a conversa acaba, a marcacao fica.
 */
parceiroAgendaRouter.get(
  "/marcacao/:sgpOsId",
  asyncHandler(async (req, res) => {
    const m = await prisma.agendamento.findUnique({
      where: { provedorId_sgpOsId: { provedorId: req.provedorParceiroId!, sgpOsId: req.params.sgpOsId } },
      select: {
        id: true,
        dia: true,
        turno: true,
        status: true,
        ordemRota: true,
        confirmadoEm: true,
        remarcacoesCliente: true,
      },
    });
    if (!m || m.status !== "marcado") return res.json(null);
    const dia = m.dia.toISOString().slice(0, 10);
    res.json({
      id: m.id,
      dia,
      turno: m.turno,
      inicioEm: agenda.inicioDoTurno(dia, m.turno).toISOString(),
      confirmada: m.confirmadoEm != null,
      remarcacoesCliente: m.remarcacoesCliente,
    });
  }),
);

/**
 * `GET /os/:sgpOsId` — andamento operacional de UMA OS (status, dia/turno,
 * primeiro nome do tecnico, posicao na rota).
 *
 * E o que responde "cade meu tecnico?": o SGP so sabe aberta/fechada. Busca
 * sempre pelo par (chave, sgpOsId) — nao existe listagem — e 404 tanto para OS
 * inexistente quanto de outro provedor, pra nao revelar que ela existe.
 * ponytail: sem ETA (o ISPhub nao calcula chegada); `inicioEm` e o inicio do turno.
 */
parceiroAgendaRouter.get(
  "/os/:sgpOsId",
  asyncHandler(async (req, res) => {
    const os = await prisma.ordemServico.findUnique({
      where: { provedorId_sgpOsId: { provedorId: req.provedorParceiroId!, sgpOsId: req.params.sgpOsId } },
      select: {
        status: true,
        tecnicoSgpNome: true,
        tecnico: { select: { nome: true } },
        agendamento: { select: { dia: true, turno: true, status: true, ordemRota: true } },
      },
    });
    if (!os) throw new HttpError(404, "OS nao encontrada");
    res.json(montarOsStatus(os, agenda.inicioDoTurno));
  }),
);

/**
 * `GET /visitas?dia=AAAA-MM-DD` — quem tem visita marcada num dia.
 *
 * Existe pro LEMBRETE: o AtendAI varre o dia seguinte e avisa cada cliente. É a
 * maior alavanca contra visita perdida, e depende de um dado que só a agenda
 * tem — quem, quando, e em que telefone.
 *
 * Só devolve quem tem telefone: sem ele não há lembrete a mandar, e listar a
 * visita mesmo assim faria o outro lado contar como "avisado" alguém que
 * ninguém avisou.
 */
parceiroAgendaRouter.get(
  "/visitas",
  asyncHandler(async (req, res) => {
    const { dia } = z
      .object({ dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD") })
      .parse(req.query);

    const linhas = await prisma.agendamento.findMany({
      where: {
        provedorId: req.provedorParceiroId!,
        dia: agenda.dataDoDia(dia),
        status: "marcado",
        // Cancelada no SGP não recebe lembrete: avisar de uma visita que não
        // vai acontecer é pior que não avisar nada.
        ordemServico: { status: { notIn: ["cancelada", "concluida"] } },
      },
      orderBy: [{ turno: "asc" }, { ordemRota: { sort: "asc", nulls: "last" } }],
      select: {
        sgpOsId: true,
        turno: true,
        ordemServico: { select: { clienteNome: true, telefone: true, bairro: true } },
      },
      take: 500,
    });

    res.json({
      dia,
      visitas: linhas
        .filter((l) => l.ordemServico?.telefone)
        .map((l) => ({
          sgpOsId: l.sgpOsId,
          turno: l.turno,
          cliente: l.ordemServico!.clienteNome,
          telefone: l.ordemServico!.telefone,
          bairro: l.ordemServico!.bairro,
        })),
    });
  }),
);

/**
 * `POST /marcacao/:sgpOsId/confirmar` — o cliente disse que estara em casa.
 *
 * Nao muda a agenda; muda o que o supervisor sabe ao montar a rota. Visita
 * confirmada e visita que provavelmente acontece, e a diferenca entre as duas
 * e o deslocamento perdido.
 */
parceiroAgendaRouter.post(
  "/marcacao/:sgpOsId/confirmar",
  asyncHandler(async (req, res) => {
    const m = await agenda.confirmarPeloCliente(req.provedorParceiroId!, req.params.sgpOsId);
    if (!m) throw new HttpError(404, "Nao ha visita marcada para esta OS");
    const dia = m.dia.toISOString().slice(0, 10);
    res.json({ dia, turno: m.turno, confirmadoEm: m.confirmadoEm });
  }),
);

/**
 * `POST /marcacao/:sgpOsId/remarcar` — o PROPRIO cliente remarcando.
 *
 * Rota separada de `/marcar` porque as regras sao outras: ha teto de vezes e
 * prazo ("ate a vespera"), e a remarcacao e contada. Usar `/marcar` com
 * `por: "cliente"` faria a atendente e o bot gastarem o teto do cliente — que
 * e o contrario do que o teto existe pra fazer.
 *
 * A recusa por limite vem com `motivo`, pra quem chama saber que a saida e
 * chamar um humano e nao oferecer outra data.
 */
parceiroAgendaRouter.post(
  "/marcacao/:sgpOsId/remarcar",
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"),
        turno: z.enum(TURNOS_AGENDA),
        regiao: z.string().trim().min(1).nullish(),
      })
      .parse(req.body);
    try {
      const m = await agenda.remarcarPeloCliente({
        provedorId: req.provedorParceiroId!,
        sgpOsId: req.params.sgpOsId,
        dia: b.dia,
        turno: b.turno,
        regiao: b.regiao,
      });
      res.status(201).json({
        id: m.id,
        dia: b.dia,
        turno: b.turno,
        inicioEm: agenda.inicioDoTurno(b.dia, b.turno).toISOString(),
      });
      void agenda.enviarAoSgp(m.id);
    } catch (e) {
      if (e instanceof agenda.LimiteDoCliente) {
        res.status(409).json({ error: e.message, motivo: e.motivo });
        return;
      }
      throw e;
    }
  }),
);

/** `DELETE /marcacao/:sgpOsId` — desmarca. A vaga volta pra grade na hora. */
parceiroAgendaRouter.delete(
  "/marcacao/:sgpOsId",
  asyncHandler(async (req, res) => {
    const m = await prisma.agendamento.findUnique({
      where: { provedorId_sgpOsId: { provedorId: req.provedorParceiroId!, sgpOsId: req.params.sgpOsId } },
      select: { id: true, status: true },
    });
    if (!m) throw new HttpError(404, "Nao ha marcacao para esta OS");
    if (m.status === "marcado") await agenda.cancelar(m.id);
    res.status(204).end();
    if (m.status === "marcado") void agenda.limparNoSgp(m.id);
  }),
);
