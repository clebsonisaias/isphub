import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

/**
 * Catalogo de categorias canonicas da ISPhub (global, nao por provedor). E a
 * taxonomia que unifica os "motivos"/tipos de OS de cada SGP — ver
 * TipoOs.categoriaId e services/categoriaMatch.ts para o auto-mapeamento.
 */
export const categoriasRouter = Router();

categoriasRouter.use(requireAuth);

const PALAVRA_MAX = 60;
const categoriaSchema = z.object({
  nome: z.string().min(1).max(80),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor deve ser um hex de 6 digitos, ex: #6366f1"),
  icone: z.string().max(60).nullable().optional(),
  palavrasChave: z.array(z.string().min(1).max(PALAVRA_MAX)).max(30).default([]),
  slaHorasPadrao: z.number().int().min(1).max(24 * 30).nullable().optional(),
  ordem: z.number().int().min(0).max(1000).default(0),
  ativo: z.boolean().optional(),
});

/**
 * Lista todas as categorias (ativas e inativas). Qualquer papel autenticado
 * pode ler — sao so rotulo/cor/icone, usados nos chips e filtros da fila por
 * tecnico/provedor tambem, nao so no admin (que gerencia via POST/PUT/DELETE).
 */
categoriasRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categorias = await prisma.categoria.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }] });
    res.json(categorias);
  }),
);

categoriasRouter.post(
  "/",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = categoriaSchema.parse(req.body);
    const categoria = await prisma.categoria.create({ data }).catch((err) => {
      if (err?.code === "P2002") throw new HttpError(409, "Ja existe uma categoria com esse nome");
      throw err;
    });
    res.status(201).json(categoria);
  }),
);

categoriasRouter.put(
  "/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = categoriaSchema.partial().parse(req.body);
    const categoria = await prisma.categoria
      .update({ where: { id: req.params.id }, data })
      .catch((err) => {
        if (err?.code === "P2002") throw new HttpError(409, "Ja existe uma categoria com esse nome");
        return null;
      });
    if (!categoria) throw new HttpError(404, "Categoria nao encontrada");
    res.json(categoria);
  }),
);

/**
 * Remove a categoria. Se ainda houver tipos de OS vinculados, faz soft-delete
 * (ativo=false, some dos filtros/seletores) em vez de apagar — assim nenhuma
 * OS historica fica com FK quebrada nem o admin perde o rotulo sem querer.
 */
categoriasRouter.delete(
  "/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const emUso = await prisma.tipoOs.count({ where: { categoriaId: req.params.id } });
    if (emUso > 0) {
      const categoria = await prisma.categoria
        .update({ where: { id: req.params.id }, data: { ativo: false } })
        .catch(() => null);
      if (!categoria) throw new HttpError(404, "Categoria nao encontrada");
      res.json({ ...categoria, softDelete: true });
      return;
    }
    await prisma.categoria.delete({ where: { id: req.params.id } }).catch(() => {
      throw new HttpError(404, "Categoria nao encontrada");
    });
    res.status(204).send();
  }),
);
