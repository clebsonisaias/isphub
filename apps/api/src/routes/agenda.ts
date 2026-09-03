import { Router } from "express";
import { z } from "zod";
import { TURNOS_AGENDA, ORIGENS_AGENDAMENTO, UserRole } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as agenda from "../services/agendaService.js";

/**
 * A agenda de OS — o que a operacao mantinha numa planilha no Drive.
 *
 * Leitura e aberta a todo mundo logado (o tecnico precisa saber o proprio dia,
 * e a atendente precisa saber o que oferecer); ESCRITA e de ADMIN/GESTOR,
 * porque marcar consome vaga de rua. O atendimento (AtendAI) entra por uma
 * porta propria, autenticada por chave — nao por esta.
 */
export const agendaRouter = Router();

agendaRouter.use(requireAuth);

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD");

const intervaloSchema = z.object({
  de: DIA.optional(),
  ate: DIA.optional(),
  regiao: z.string().trim().min(1).optional(),
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
    res.json({ config, vagas: await agenda.grade({ de, ate, regiao: q.regiao }) });
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

    const config = await agenda.lerConfig();
    const hoje = agenda.diaBrDe(new Date());
    const ocupacoes = await agenda.ocupacoesEntre(hoje, agenda.somarDias(hoje, config.horizonteDias), regiao);
    res.json(agenda.proximasVagas({ agora: new Date(), config, ocupacoes, quantas }));
  }),
);

/** `GET /agenda/turno` — as paradas de uma janela, na ordem da rota. */
agendaRouter.get(
  "/turno",
  asyncHandler(async (req, res) => {
    const { dia, turno } = z.object({ dia: DIA, turno: z.enum(TURNOS_AGENDA) }).parse(req.query);
    res.json(await agenda.doTurno(dia, turno));
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
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const b = marcarSchema.parse(req.body);
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
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    res.json(await agenda.cancelar(req.params.id));
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
    await agenda.definirRota(ids);
    res.json(await agenda.doTurno(dia, turno));
  }),
);

/** A grade configuravel — a aba "Configuracoes" da planilha. */
export const adminAgendaRouter = Router();

adminAgendaRouter.use(requireAuth, requireRole(UserRole.ADMIN));

adminAgendaRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await agenda.lerConfig());
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
      })
      .partial()
      .parse(req.body);
    res.json(await agenda.salvarConfig(b));
  }),
);
