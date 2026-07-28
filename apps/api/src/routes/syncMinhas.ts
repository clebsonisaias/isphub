import { Router } from "express";
import { OS_STATUS_ABERTOS } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { escopoOsWhere } from "../services/escopoService.js";
import { syncProvedor } from "../services/syncService.js";
import { bloqueadoPorRate, provedoresParaSincronizar } from "../services/syncMinhasService.js";

/**
 * `POST /sync/minhas-os` — "sincronizar agora" do app do tecnico. Dispara o
 * pull do SGP dos provedores que tem OS abertas atribuidas ao usuario (escopo
 * server-side), deduplicando por provedor, com rate-limit por usuario pra nao
 * martelar o SGP. Usado no botao e no pull-to-refresh.
 */
export const syncMinhasRouter = Router();

syncMinhasRouter.use(requireAuth);

const ultimoSyncPorUsuario = new Map<string, number>();

syncMinhasRouter.post(
  "/minhas-os",
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    const agora = Date.now();
    if (bloqueadoPorRate(ultimoSyncPorUsuario.get(userId), agora)) {
      throw new HttpError(429, "Aguarde alguns segundos antes de sincronizar de novo");
    }
    ultimoSyncPorUsuario.set(userId, agora);

    const osAbertas = await prisma.ordemServico.findMany({
      where: { ...escopoOsWhere(req.user!), status: { in: OS_STATUS_ABERTOS } },
      select: { provedorId: true },
    });
    const provedores = provedoresParaSincronizar(osAbertas);
    // Best-effort: um provedor que falha nao derruba os outros.
    for (const provedorId of provedores) {
      try {
        await syncProvedor(provedorId);
      } catch {
        // erro ja e logado dentro do syncProvedor/logSync
      }
    }
    res.json({ sincronizados: provedores.length });
  }),
);
