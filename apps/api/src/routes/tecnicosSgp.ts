import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  FUNCOES_CAMPO,
  decidirTecnicoSgp,
  listarTecnicosSgp,
  sincronizarTecnicosSgp,
} from "../services/tecnicosSgpService.js";

/**
 * Aba "Tecnicos do SGP" do provedor: a lista que o SGP conhece e, pra cada um,
 * a decisao do admin/supervisor — vincular, criar (sem login) ou ignorar — e a
 * funcao (tecnico ou auxiliar).
 */
export const tecnicosSgpRouter = Router({ mergeParams: true });

tecnicosSgpRouter.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.GESTOR));

tecnicosSgpRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listarTecnicosSgp(req.params.provedorId!));
  }),
);

/** `POST /sincronizar` — busca agora no SGP (o job tambem faz todo dia as 06:10). */
tecnicosSgpRouter.post(
  "/sincronizar",
  asyncHandler(async (req, res) => {
    res.json(await sincronizarTecnicosSgp(req.params.provedorId!));
  }),
);

tecnicosSgpRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const d = z
      .object({
        usuarioId: z.string().uuid().nullable().optional(),
        criar: z.boolean().optional(),
        ignorado: z.boolean().optional(),
        funcao: z.enum(FUNCOES_CAMPO).nullable().optional(),
      })
      .parse(req.body);
    res.json(await decidirTecnicoSgp(req.params.provedorId!, req.params.id!, d));
  }),
);
