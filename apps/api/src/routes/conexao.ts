import { Router } from "express";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { buildConnector } from "../services/erpConnectorService.js";

export const conexaoRouter = Router({ mergeParams: true });

conexaoRouter.use(requireAuth);

/**
 * Consulta ao vivo (nao faz parte do sync em massa — chamada sob demanda ao
 * abrir o detalhe de uma OS/ocorrencia) se o servico do contrato esta
 * online ou offline agora no SGP.
 */
conexaoRouter.get(
  "/:contratoId",
  asyncHandler(async (req, res) => {
    const { provedorId, contratoId } = req.params;

    if (req.user!.role === UserRole.PROVEDOR && req.user!.provedorId !== provedorId) {
      throw new HttpError(403, "Acesso restrito ao proprio provedor");
    }

    const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
    if (!config) throw new HttpError(404, "Integracao SGP nao configurada/ativa para este provedor");

    const connector = buildConnector(config);
    const resultado = await connector.checkConnectionStatus(contratoId);
    res.json(resultado);
  }),
);
