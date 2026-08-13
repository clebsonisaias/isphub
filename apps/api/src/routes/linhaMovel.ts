import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validarUrlExterna } from "../lib/urlValidation.js";
import * as linhaMovel from "../services/linhaMovelService.js";

/**
 * Linha movel corporativa (chip CITmax/Brazmovel).
 *
 * Duas metades com riscos muito diferentes, e vale ler juntas:
 *
 *  - `GET /minha` — **nao aceita parametro nenhum**. O `lineId` sai do banco
 *    pelo id do usuario do token. Nao existe requisicao possivel em que um
 *    tecnico peca a linha do colega, porque nao ha onde escrever qual linha.
 *  - `/usuarios/:id/*` — ADMIN. E o unico ponto do sistema onde um CPF qualquer
 *    produz resposta: o token da operadora vale para a base INTEIRA da CITmax.
 *    Por isso devolve so numero mascarado e status, confere o nome do titular
 *    contra o do cadastro, e tem limite de taxa proprio.
 */
export const linhaMovelRouter = Router();

linhaMovelRouter.use(requireAuth);

/**
 * A busca por CPF e config, nao operacao — 20/hora e folgado para cadastrar uma
 * equipe e apertado para varrer CPFs.
 */
const buscaCpfLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas consultas de CPF. Tente novamente mais tarde." },
});

// ---------------------------------------------------------------------------
// O tecnico: a propria linha
// ---------------------------------------------------------------------------

/**
 * A linha do usuario autenticado.
 *
 * `PROVEDOR` fica de fora explicitamente: e um ISP externo, cliente da operacao,
 * que nunca tem chip corporativo. Sem esta linha ele receberia "sem_vinculo" —
 * que funciona por acidente, nao por decisao.
 */
linhaMovelRouter.get(
  "/minha",
  requireRole(UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO),
  asyncHandler(async (req, res) => {
    res.json(await linhaMovel.minhaLinha(req.user!.sub));
  }),
);

// ---------------------------------------------------------------------------
// ADMIN: credencial da operadora
// ---------------------------------------------------------------------------

linhaMovelRouter.get(
  "/config",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (_req, res) => {
    // `null` quando nunca foi configurada — a tela mostra o formulario vazio.
    res.json(await linhaMovel.configPublica());
  }),
);

const configSchema = z.object({
  // A URL vem de formulario — sem esta guarda ela seria um vetor de SSRF.
  baseUrl: z.string().url().superRefine(validarUrlExterna).optional(),
  // Token ausente no update = manter o atual. A tela escreve, nunca le.
  token: z.string().min(10).optional(),
  ativo: z.boolean().optional(),
});

linhaMovelRouter.put(
  "/config",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    res.json(await linhaMovel.salvarConfig(configSchema.parse(req.body)));
  }),
);

linhaMovelRouter.post(
  "/config/testar",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (_req, res) => {
    res.json(await linhaMovel.testarConexao());
  }),
);

// ---------------------------------------------------------------------------
// ADMIN: vinculo de um usuario
// ---------------------------------------------------------------------------

const buscaSchema = z.object({ cpf: z.string().min(11) });

/**
 * Quais linhas este CPF tem?
 *
 * Devolve numero MASCARADO e status, e mais nada. `nomeConfere` diz se o titular
 * na operadora bate com o nome do cadastro — o nome encontrado nunca volta, para
 * a tela nao virar um consultor de "de quem e este CPF".
 */
linhaMovelRouter.post(
  "/usuarios/:id/buscar",
  requireRole(UserRole.ADMIN),
  buscaCpfLimiter,
  asyncHandler(async (req, res) => {
    const { cpf } = buscaSchema.parse(req.body);
    res.json(await linhaMovel.buscarCandidatas(req.params.id!, cpf));
  }),
);

const vincularSchema = z.object({ lineId: z.string().min(1) });

linhaMovelRouter.put(
  "/usuarios/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const { lineId } = vincularSchema.parse(req.body);
    await linhaMovel.vincular(req.params.id!, lineId);
    res.json({ ok: true });
  }),
);

linhaMovelRouter.delete(
  "/usuarios/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    await linhaMovel.desvincular(req.params.id!);
    res.json({ ok: true });
  }),
);

/**
 * O vinculo atual de um usuario, para a tela de cadastro mostrar o estado.
 *
 * Devolve so se EXISTE vinculo — nem o `lineId`, que nao serve para nada na
 * tela e e o identificador da linha na operadora.
 */
linhaMovelRouter.get(
  "/usuarios/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const vinculado = await linhaMovel.temVinculo(req.params.id!);
    if (vinculado === null) throw new HttpError(404, "Usuário não encontrado");
    res.json({ vinculado });
  }),
);
