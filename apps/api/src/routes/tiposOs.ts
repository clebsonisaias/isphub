import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { buildConnector } from "../services/erpConnectorService.js";

export const tiposOsRouter = Router({ mergeParams: true });

tiposOsRouter.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.GESTOR));

tiposOsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tipos = await prisma.tipoOs.findMany({
      where: { provedorId: req.params.provedorId },
      orderBy: { descricao: "asc" },
    });
    res.json(tipos);
  }),
);

/**
 * Busca o catalogo de tipos de OS direto no SGP do provedor e faz upsert
 * local (por sgpCodigo). Tipos novos entram com visivel=true e sem SLA
 * definido; tipos ja existentes preservam visivel/slaHoras (so a descricao
 * e atualizada, caso o SGP tenha renomeado o tipo).
 */
tiposOsRouter.post(
  "/importar",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const config = await prisma.erpConfig.findFirst({
      where: { provedorId: req.params.provedorId, tipo: "SGP" },
    });
    if (!config) throw new HttpError(404, "Integracao SGP nao configurada para este provedor");

    const connector = buildConnector(config);
    const tiposSgp = await connector.listOsTypes();

    const resultados = await prisma.$transaction(
      tiposSgp.map((t) =>
        prisma.tipoOs.upsert({
          where: { provedorId_sgpCodigo: { provedorId: req.params.provedorId, sgpCodigo: t.sgpCodigo } },
          create: {
            provedorId: req.params.provedorId,
            sgpCodigo: t.sgpCodigo,
            descricao: t.descricao,
          },
          update: { descricao: t.descricao },
        }),
      ),
    );

    res.json({ importados: resultados.length, tipos: resultados });
  }),
);

const patchSchema = z.object({
  visivel: z.boolean().optional(),
  slaHoras: z.number().int().min(1).max(24 * 30).nullable().optional(),
  categoria: z.enum(["ocorrencia", "instalacao"]).optional(),
});

tiposOsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = patchSchema.parse(req.body);
    const tipo = await prisma.tipoOs
      .update({ where: { id: req.params.id }, data })
      .catch(() => null);
    if (!tipo) throw new HttpError(404, "Tipo de OS nao encontrado");
    res.json(tipo);
  }),
);
