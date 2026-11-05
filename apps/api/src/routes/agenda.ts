import { Router } from "express";
import { z } from "zod";
import { TURNOS_AGENDA, ORIGENS_AGENDAMENTO, UserRole, metrosDaOrdem, sugerirOrdem } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as agenda from "../services/agendaService.js";
import { rodarPlanilha, ultimaRodadaPlanilha } from "../services/planilhaSyncService.js";
import {
  aplicarPropostas,
  desfazerLoteAuto,
  proporAgendaDoBanco,
  saudeDoAgendador,
} from "../services/autoAgendaService.js";
import { aplicarRedistribuicao, propostaRedistribuicao } from "../services/redistribuicaoService.js";
import {
  exigirAgendamentosNoEscopo,
  exigirEscopoTotal,
  exigirProvedor,
  podeProvedor,
  provedoresDoUsuario,
} from "../services/escopoService.js";

/**
 * A agenda de OS — o que a operacao mantinha numa planilha no Drive.
 *
 * Leitura e aberta a todo mundo logado (o tecnico precisa saber o proprio dia,
 * e a atendente precisa saber o que oferecer); ESCRITA e de ADMIN/GESTOR e, so
 * marcar/desmarcar no proprio provedor, do ATENDENTE. O atendimento (AtendAI) entra por uma
 * porta propria, autenticada por chave — nao por esta.
 */
export const agendaRouter = Router();

agendaRouter.use(requireAuth);

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD");

const intervaloSchema = z.object({
  de: DIA.optional(),
  ate: DIA.optional(),
  regiao: z.string().trim().min(1).optional(),
  equipe: z.enum(["interna", "externa", "todas"]).optional(),
});

/**
 * `GET /agenda/vagas` — a grade dia x turno. E a aba "Painel" da planilha.
 *
 * Sem `de`/`ate` devolve o horizonte configurado a partir de hoje, que e o que
 * a tela abre e o que o atendimento pergunta.
 */
agendaRouter.get(
  "/vagas",
  asyncHandler(async (req, res) => {
    const q = intervaloSchema.parse(req.query);
    const config = await agenda.lerConfig();
    const de = q.de ?? agenda.diaBrDe(new Date());
    const ate = q.ate ?? agenda.somarDias(de, config.horizonteDias);
    res.json({ config, vagas: await agenda.grade({ de, ate, regiao: q.regiao, equipe: q.equipe }) });
  }),
);

/**
 * `GET /agenda/proximas` — so o que cabe, ja em ordem.
 *
 * Existe separado de `/vagas` porque e um contrato diferente: aqui nada
 * bloqueado sai. E o que a atendente le ao telefone e o que o bot oferece, e
 * misturar as duas coisas na mesma rota acabaria com alguem exibindo uma janela
 * cheia por ter lido o campo errado.
 */
agendaRouter.get(
  "/proximas",
  asyncHandler(async (req, res) => {
    const { regiao, quantas } = z
      .object({ regiao: z.string().trim().min(1).optional(), quantas: z.coerce.number().int().min(1).max(30).default(6) })
      .parse(req.query);

    res.json(await agenda.proximasVagasDoBanco({ regiao, quantas }));
  }),
);

/**
 * `GET /agenda/minhas` — o que ESTE usuario marcou ou remarcou hoje (horario de
 * Brasilia), mais recente primeiro. E a lista "Marcadas por voce hoje" da tela
 * da atendente: conferir o que ja fez e desfazer o engano.
 */
agendaRouter.get(
  "/minhas",
  asyncHandler(async (req, res) => {
    // Meia-noite de Brasilia (UTC-3, sem horario de verao) em UTC.
    const inicio = new Date(`${agenda.diaBrDe(new Date())}T03:00:00.000Z`);
    const itens = await prisma.agendamento.findMany({
      where: { marcadoPor: req.user!.email, status: "marcado", atualizadoEm: { gte: inicio } },
      orderBy: { atualizadoEm: "desc" },
      take: 30,
      select: { id: true, sgpOsId: true, dia: true, turno: true, atualizadoEm: true, ordemServico: { select: { id: true, clienteNome: true } } },
    });
    res.json(
      itens.map((i) => ({
        id: i.id,
        sgpOsId: i.sgpOsId,
        dia: i.dia.toISOString().slice(0, 10),
        turno: i.turno,
        em: i.atualizadoEm.toISOString(),
        osId: i.ordemServico?.id ?? null,
        clienteNome: i.ordemServico?.clienteNome ?? null,
      })),
    );
  }),
);

/** `GET /agenda/turno` — as paradas de uma janela, na ordem da rota. */
agendaRouter.get(
  "/turno",
  asyncHandler(async (req, res) => {
    const { dia, turno, equipe } = z
      .object({
        dia: DIA,
        turno: z.enum(TURNOS_AGENDA),
        equipe: z.enum(["interna", "externa", "todas"]).optional(),
      })
      .parse(req.query);
    // Atendente (e gestor limitado) so ve as paradas (nome, telefone, endereco) dos provedores dele.
    res.json(await agenda.doTurno(dia, turno, provedoresDoUsuario(req.user!) ?? undefined, equipe));
  }),
);

/**
 * `GET /agenda/turno/sugestao` — a ordem sugerida pra rota de uma janela.
 * NAO grava: quem grava e `PUT /rota`, quando o supervisor aceita.
 */
agendaRouter.get(
  "/turno/sugestao",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dia, turno } = z.object({ dia: DIA, turno: z.enum(TURNOS_AGENDA) }).parse(req.query);
    const [paradas, config] = await Promise.all([
      agenda.doTurno(dia, turno, provedoresDoUsuario(req.user!) ?? undefined),
      agenda.lerConfig(),
    ]);
    const origem = config.baseLat != null && config.baseLng != null ? { lat: config.baseLat, lng: config.baseLng } : null;
    const lista = paradas.map((p) => ({ id: p.id, lat: p.ordemServico?.lat ?? null, lng: p.ordemServico?.lng ?? null }));
    const sugestao = sugerirOrdem(lista, origem);
    res.json({ ...sugestao, metrosAtual: metrosDaOrdem(lista, origem), comOrigem: origem !== null });
  }),
);

/**
 * `GET /agenda/auto/proposta` — dia e turno propostos pra OS abertas sem visita.
 * NAO grava e NAO atribui tecnico: o supervisor revisa, e so a Fase 3 aplica.
 * `propostas` e a lista `{sgpOsId, dia, turno, regiao, motivo}`; `revisao` sao as
 * OS que precisam de gente (sem categoria...), `semVaga` as que nao couberam.
 */
agendaRouter.get(
  "/auto/proposta",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const r = await proporAgendaDoBanco();
    // Gestor limitado: so o que e dos provedores dele (a capacidade continua global).
    const dele = <T extends { provedorId: string }>(xs: T[]) => xs.filter((x) => podeProvedor(req.user!, x.provedorId));
    res.json({ ...r, propostas: dele(r.propostas), revisao: dele(r.revisao), semVaga: dele(r.semVaga) });
  }),
);

const propostaParaAplicar = z.object({
  provedorId: z.string().min(1),
  sgpOsId: z.string().min(1),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turno: z.enum(TURNOS_AGENDA),
  regiao: z.string().nullable().optional(),
  fila: z.enum(["normal", "retirada"]).optional(),
});

/**
 * `POST /agenda/auto/aplicar` — grava as propostas que o supervisor aprovou.
 * Cada uma passa por `marcar()` de novo, entao o que nao cabe mais volta em
 * `recusadas` (nao e erro). Nao atribui tecnico.
 */
agendaRouter.post(
  "/auto/aplicar",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { propostas } = z.object({ propostas: z.array(propostaParaAplicar).min(1).max(200) }).parse(req.body);
    for (const p of propostas) exigirProvedor(req.user!, p.provedorId);
    res.json(await aplicarPropostas(propostas, req.user?.email ?? "supervisor"));
  }),
);

/** `POST /agenda/auto/desfazer` — desfaz o que o agendador marcou hoje (menos o que o cliente ja confirmou). */
agendaRouter.post(
  "/auto/desfazer",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    exigirEscopoTotal(req.user!);
    res.json(await desfazerLoteAuto());
  }),
);

/** `GET /agenda/auto/saude` — o painel pra confiar (ou nao) no agendador. */
agendaRouter.get(
  "/auto/saude",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (_req, res) => {
    res.json(await saudeDoAgendador());
  }),
);

/** `GET /agenda/planilha` — resumo da ultima rodada do robo da planilha (nulo antes da 1a). */
agendaRouter.get(
  "/planilha",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    exigirEscopoTotal(req.user!);
    res.json(ultimaRodadaPlanilha());
  }),
);

/** `POST /agenda/planilha/rodar` — roda o robo agora, sem esperar os 15 min. */
agendaRouter.post(
  "/planilha/rodar",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    exigirEscopoTotal(req.user!);
    res.json(await rodarPlanilha());
  }),
);

/** Quem faltou tinha paradas: a proposta de quem assume cada uma. Nao grava. */
agendaRouter.get(
  "/redistribuicao",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    exigirEscopoTotal(req.user!);
    const q = z.object({ dia: DIA, turno: z.enum(TURNOS_AGENDA), usuarioId: z.string().uuid() }).parse(req.query);
    res.json(await propostaRedistribuicao(q.dia, q.turno, q.usuarioId));
  }),
);

/** Aplica a redistribuicao aprovada pelo supervisor. */
agendaRouter.post(
  "/redistribuir",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const b = z
      .object({ itens: z.array(z.object({ agendamentoId: z.string().uuid(), tecnicoId: z.string().uuid() })).min(1).max(100) })
      .parse(req.body);
    await exigirAgendamentosNoEscopo(req.user!, b.itens.map((i) => i.agendamentoId));
    res.json({ aplicadas: await aplicarRedistribuicao(b.itens, req.user!.sub) });
  }),
);

const marcarSchema = z.object({
  provedorId: z.string().uuid(),
  sgpOsId: z.string().trim().min(1),
  dia: DIA,
  turno: z.enum(TURNOS_AGENDA),
  regiao: z.string().trim().min(1).nullish(),
  origem: z.enum(ORIGENS_AGENDAMENTO).default("isphub"),
  observacao: z.string().trim().max(500).nullish(),
});

/**
 * `POST /agenda` — marca ou remarca. Recusa com 409 quando nao cabe.
 *
 * `marcadoPor` vem do token, nunca do corpo: e trilha de auditoria, e quem
 * responde por ela e o servidor.
 */
agendaRouter.post(
  "/",
  requireRole(UserRole.ADMIN, UserRole.GESTOR, UserRole.ATENDENTE),
  asyncHandler(async (req, res) => {
    const b = marcarSchema.parse(req.body);
    // Atendente so no proprio provedor; gestor limitado, nos da lista dele.
    exigirProvedor(req.user!, b.provedorId);
    const marcado = await agenda.marcar({ ...b, marcadoPor: req.user!.email });
    // Responde ANTES do write-back: a marcacao ja e verdade aqui, e o ERP do
    // provedor fora do ar nao pode virar espera na tela de quem esta ao
    // telefone. `sgpConfirmadoEm` conta essa historia depois.
    res.status(201).json(marcado);
    void agenda.enviarAoSgp(marcado.id);
  }),
);

/** `DELETE /agenda/:id` — desmarca. A vaga volta pra grade. */
agendaRouter.delete(
  "/:id",
  requireRole(UserRole.ADMIN, UserRole.GESTOR, UserRole.ATENDENTE),
  asyncHandler(async (req, res) => {
    if (provedoresDoUsuario(req.user!)) {
      const m = await prisma.agendamento.findUnique({ where: { id: req.params.id }, select: { provedorId: true } });
      if (!m) throw new HttpError(404, "Agendamento nao encontrado");
      exigirProvedor(req.user!, m.provedorId);
    }
    const cancelado = await agenda.cancelar(req.params.id, { origem: "isphub", autor: req.user!.email });
    res.json(cancelado);
    // Depois da resposta, como no marcar: o SGP alcanca a agenda, nao o contrario.
    void agenda.limparNoSgp(cancelado.id);
  }),
);

/**
 * `PUT /agenda/rota` — a ordem das paradas de uma janela, inteira.
 *
 * Em lote porque arrastar UMA parada renumera todas: uma requisicao por posicao
 * deixaria a rota metade nova e metade antiga se alguma falhasse no meio.
 */
agendaRouter.put(
  "/rota",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dia, turno, ids } = z
      .object({ dia: DIA, turno: z.enum(TURNOS_AGENDA), ids: z.array(z.string().uuid()).max(200) })
      .parse(req.body);
    await exigirAgendamentosNoEscopo(req.user!, ids);
    await agenda.definirRota(ids);
    res.json(await agenda.doTurno(dia, turno, provedoresDoUsuario(req.user!) ?? undefined));
  }),
);

/** A grade configuravel — a aba "Configuracoes" da planilha. */
export const adminAgendaRouter = Router();

// ADMIN e GESTOR: o gestor ja ve o botao de limites na tela e ja pode marcar
// visita — recusar aqui so dava 403 depois de ele preencher o formulario.
// A grade e uma so pra todos os provedores: ler e livre, mas ESCREVER exige
// escopo total (gestor limitado a alguns provedores nao mexe na dos outros).
adminAgendaRouter.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.GESTOR), (req, _res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") exigirEscopoTotal(req.user!);
  next();
});

adminAgendaRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await agenda.lerConfig());
  }),
);

/**
 * As excecoes de calendario. Feriado NACIONAL nao aparece aqui — aquele e
 * calculado, e nao ha o que cadastrar.
 */
adminAgendaRouter.get(
  "/excecoes",
  asyncHandler(async (_req, res) => {
    res.json(await agenda.listarExcecoes());
  }),
);

adminAgendaRouter.put(
  "/excecoes",
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        dia: DIA,
        atende: z.boolean().default(false),
        motivo: z.string().trim().min(1).max(120),
      })
      .parse(req.body);
    await agenda.salvarExcecao({ ...b, definidoPor: req.user!.email });
    res.json(await agenda.listarExcecoes());
  }),
);

adminAgendaRouter.delete(
  "/excecoes/:dia",
  asyncHandler(async (req, res) => {
    await agenda.removerExcecao(DIA.parse(req.params.dia));
    res.json(await agenda.listarExcecoes());
  }),
);

adminAgendaRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        vagasManha: z.number().int().min(0).max(500),
        vagasTarde: z.number().int().min(0).max(500),
        // Nulo = sem teto próprio; o limite do dia vira a soma dos turnos.
        vagasDia: z.number().int().min(0).max(1000).nullable(),
        tetoRegiao: z.number().int().min(1).max(500).nullable(),
        // Sem dia atendido nenhum a agenda nunca ofereceria nada, e a tela
        // ficaria vazia sem dizer por que.
        diasAtendidos: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        horizonteDias: z.number().int().min(1).max(90),
        antecedenciaMin: z.number().int().min(0).max(10_080),
        remarcacoesMaxCliente: z.number().int().min(0).max(10),
        // Origem da rota sugerida. Os dois juntos ou os dois nulos.
        baseLat: z.number().min(-90).max(90).nullable(),
        baseLng: z.number().min(-180).max(180).nullable(),
        // Nulo = capacidade fixa; preenchido, a escala do dia manda.
        vagasPorTecnico: z.number().int().min(1).max(50).nullable(),
        // Fatia do dia reservada a retirada; 0 = so a sobra.
        vagasRetiradaDia: z.number().int().min(0).max(500),
        // Chave do agendador automatico, teto por rodada e reserva de urgencia.
        autoAgendaAtiva: z.boolean(),
        autoAgendaMaxRodada: z.number().int().min(1).max(200),
        vagasUrgenciaDia: z.number().int().min(0).max(500),
        // Teto do domingo (so manha); nulo = teto normal do turno.
        vagasDomingo: z.number().int().min(0).max(500).nullable(),
      })
      .partial()
      .parse(req.body);
    res.json(await agenda.salvarConfig(b));
  }),
);
