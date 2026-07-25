import { Router } from "express";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const tecnicosRouter = Router({ mergeParams: true });

tecnicosRouter.use(requireAuth);

/** Lista tecnicos do provedor (para popular o seletor de atribuicao na fila). */
tecnicosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const provedorId =
      req.user!.role === UserRole.PROVEDOR ? req.user!.provedorId ?? "__nenhum__" : req.params.provedorId;
    const tecnicos = await prisma.tecnico.findMany({
      where: { provedorId, ativo: true },
      orderBy: { nome: "asc" },
    });
    res.json(tecnicos);
  }),
);
