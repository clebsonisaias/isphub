import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { buildConnector } from "../services/erpConnectorService.js";
import { sugerirCategoriaId } from "../services/categoriaMatch.js";

export const tiposOsRouter = Router({ mergeParams: true });

tiposOsRouter.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.GESTOR));

const CATEGORIA_RESUMO_SELECT = { id: true, nome: true, cor: true, icone: true, slaHorasPadrao: true, equipeExterna: true } as const;

tiposOsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tipos = await prisma.tipoOs.findMany({
      where: { provedorId: req.params.provedorId },
      include: { categoria: { select: CATEGORIA_RESUMO_SELECT } },
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

    // Categorias ativas, pra sugerir automaticamente a categoria dos tipos
    // novos (nunca sobrescreve tipos ja existentes, que podem ter sido
    // classificados manualmente pelo admin).
    const categorias = await prisma.categoria.findMany({ where: { ativo: true } });
    const existentes = await prisma.tipoOs.findMany({
      where: { provedorId: req.params.provedorId },
      select: { sgpCodigo: true },
    });
    const jaExistiaSet = new Set(existentes.map((t) => t.sgpCodigo));

    const resultados = await prisma.$transaction(
      tiposSgp.map((t) =>
        prisma.tipoOs.upsert({
          where: { provedorId_sgpCodigo: { provedorId: req.params.provedorId, sgpCodigo: t.sgpCodigo } },
          create: {
            provedorId: req.params.provedorId,
            sgpCodigo: t.sgpCodigo,
            descricao: t.descricao,
            categoriaId: jaExistiaSet.has(t.sgpCodigo) ? undefined : sugerirCategoriaId(t.descricao, categorias),
          },
          update: { descricao: t.descricao },
          include: { categoria: { select: CATEGORIA_RESUMO_SELECT } },
        }),
      ),
    );

    res.json({ importados: resultados.length, tipos: resultados });
  }),
);

/**
 * Aplica o auto-mapeamento por palavra-chave a todos os tipos deste provedor
 * que ainda estao "Nao classificado" (categoriaId=null). Nunca mexe em tipos
 * ja classificados, manual ou automaticamente. Util pra tipos antigos, criados
 * antes do catalogo de categorias existir ou auto-criados durante um sync.
 */
tiposOsRouter.post(
  "/auto-classificar",
  asyncHandler(async (req, res) => {
    const categorias = await prisma.categoria.findMany({ where: { ativo: true } });
    const semCategoria = await prisma.tipoOs.findMany({
      where: { provedorId: req.params.provedorId, categoriaId: null },
    });

    let classificados = 0;
    await prisma.$transaction(
      semCategoria.flatMap((tipo) => {
        const categoriaId = sugerirCategoriaId(tipo.descricao, categorias);
        if (!categoriaId) return [];
        classificados += 1;
        return [prisma.tipoOs.update({ where: { id: tipo.id }, data: { categoriaId } })];
      }),
    );

    res.json({ analisados: semCategoria.length, classificados });
  }),
);

const patchSchema = z.object({
  visivel: z.boolean().optional(),
  slaHoras: z.number().int().min(1).max(24 * 30).nullable().optional(),
  categoriaId: z.string().uuid().nullable().optional(),
});

tiposOsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = patchSchema.parse(req.body);
    const existente = await prisma.tipoOs.findFirst({
      where: { id: req.params.id, provedorId: req.params.provedorId },
    });
    if (!existente) throw new HttpError(404, "Tipo de OS nao encontrado");

    if (data.categoriaId) {
      const categoria = await prisma.categoria.findUnique({ where: { id: data.categoriaId } });
      if (!categoria) throw new HttpError(404, "Categoria nao encontrada");
    }

    const tipo = await prisma.tipoOs.update({
      where: { id: req.params.id },
      data,
      include: { categoria: { select: CATEGORIA_RESUMO_SELECT } },
    });
    res.json(tipo);
  }),
);
