import { Router } from "express";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const tecnicosRouter = Router();

/**
 * Tecnicos sao usuarios da ISPhub (role=tecnico), nao pessoal de um provedor
 * especifico — por isso a lista e global, nao mais escopada por provedor.
 * So ADMIN/GESTOR usam (pra popular o seletor de atribuicao na fila); um
 * usuario tecnico nunca precisa da lista dos outros tecnicos.
 */
tecnicosRouter.get(
  "/",
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (_req, res) => {
    const tecnicos = await prisma.usuario.findMany({
      where: { role: UserRole.TECNICO, ativo: true },
      select: { id: true, nome: true, email: true },
      orderBy: { nome: "asc" },
    });
    res.json(tecnicos);
  }),
);
