import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  obterSugestaoRotaTecnico,
  aplicarOrdemRotaTecnico,
  obterTecnicosProximos,
  despacharEmergencial,
  obterMinhaRotaDoDia,
  otimizarTodasRotasDoDia,
} from "../services/logisticaService.js";

export const logisticaRouter = Router();

logisticaRouter.use(requireAuth);

const DIA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /logistica/minha-rota-do-dia`
 * Retorna as paradas do técnico logado para o dia na sequência ótima, com distâncias e link do Google Maps.
 */
logisticaRouter.get(
  "/minha-rota-do-dia",
  asyncHandler(async (req, res) => {
    const { dia } = z
      .object({
        dia: z.string().regex(DIA_REGEX, "Data deve ser AAAA-MM-DD").optional(),
      })
      .parse(req.query);

    const resultado = await obterMinhaRotaDoDia(req.user!.sub, dia);
    res.json(resultado);
  }),
);

/**
 * `POST /logistica/robo-otimizar-dia`
 * Dispara o Robô de Roteirização para calcular a melhor ordem de paradas de todos os técnicos do dia.
 */
logisticaRouter.post(
  "/robo-otimizar-dia",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dia } = z
      .object({
        dia: z.string().regex(DIA_REGEX, "Data deve ser AAAA-MM-DD").optional(),
      })
      .parse(req.body);

    const resultado = await otimizarTodasRotasDoDia(dia, req.user?.provedorId);
    res.json(resultado);
  }),
);

/**
 * `GET /logistica/tecnico/:tecnicoId/rota-otimizada`
 * Calcula a rota ideal para as paradas do técnico no dia/turno e economia de km/minutos.
 */
logisticaRouter.get(
  "/tecnico/:tecnicoId/rota-otimizada",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dia, turno } = z
      .object({
        dia: z.string().regex(DIA_REGEX, "Data deve ser AAAA-MM-DD"),
        turno: z.enum(["manha", "tarde", "dia_inteiro"]).optional(),
      })
      .parse(req.query);

    const resultado = await obterSugestaoRotaTecnico(req.params.tecnicoId, dia, turno);
    res.json(resultado);
  }),
);

/**
 * `POST /logistica/tecnico/:tecnicoId/aplicar-rota`
 * Grava a nova ordem de paradas de um técnico.
 */
logisticaRouter.post(
  "/tecnico/:tecnicoId/aplicar-rota",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { ids } = z
      .object({
        ids: z.array(z.string().uuid()).min(1),
      })
      .parse(req.body);

    await aplicarOrdemRotaTecnico(ids);
    res.json({ ok: true, total: ids.length });
  }),
);

/**
 * `GET /logistica/os/:osId/proximidade-tecnicos`
 * Lista técnicos ativos ordenados pela menor distância física em relação à O.S. urgente.
 */
logisticaRouter.get(
  "/os/:osId/proximidade-tecnicos",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const resultado = await obterTecnicosProximos(req.params.osId);
    res.json(resultado);
  }),
);

/**
 * `POST /logistica/os/:osId/despacho-emergencial`
 * Atribui a O.S. urgente ao técnico escolhido, encaixando como 1ª parada prioritária.
 */
logisticaRouter.post(
  "/os/:osId/despacho-emergencial",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { tecnicoId, encaixarPrimeiro, turno } = z
      .object({
        tecnicoId: z.string().uuid(),
        encaixarPrimeiro: z.boolean().optional(),
        turno: z.enum(["manha", "tarde"]).optional(),
      })
      .parse(req.body);

    const resultado = await despacharEmergencial(req.params.osId, tecnicoId, {
      encaixarPrimeiro: encaixarPrimeiro ?? true,
      turno,
      usuarioAutorId: req.user?.sub,
    });

    res.json(resultado);
  }),
);
