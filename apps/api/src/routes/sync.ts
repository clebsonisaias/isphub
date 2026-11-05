import { Router } from "express";
import { UserRole } from "@isphub/shared";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { syncProvedor } from "../services/syncService.js";
import { prisma } from "../lib/prisma.js";

export const syncRouter = Router({ mergeParams: true });

syncRouter.use(requireAuth, requireRole(UserRole.ADMIN));

/** Dispara uma sincronizacao imediata (fora do ciclo do scheduler). */
syncRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const resultado = await syncProvedor(req.params.provedorId);
    res.json(resultado);
  }),
);

/** Historico de sync (para diagnostico na tela de Admin). */
syncRouter.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const logs = await prisma.syncLog.findMany({
      where: { provedorId: req.params.provedorId },
      orderBy: { iniciadoEm: "desc" },
      take: 50,
    });
    res.json(logs);
  }),
);
