import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const provedoresRouter = Router();

provedoresRouter.use(requireAuth);

const provedorSchema = z.object({
  nome: z.string().min(1),
  cor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "cor deve ser um hex de 6 digitos, ex: #6366f1")
    .default("#6366f1"),
  logoUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), "logoUrl deve ser http(s)")
    .nullable()
    .optional(),
  ativo: z.boolean().optional(),
});

/** Lista provedores. Admin/gestor veem todos; provedor ve so o proprio. */
provedoresRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = req.user!.role === UserRole.PROVEDOR ? { id: req.user!.provedorId ?? "" } : {};
    const provedores = await prisma.provedor.findMany({ where, orderBy: { nome: "asc" } });
    res.json(provedores);
  }),
);

provedoresRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user!.role === UserRole.PROVEDOR && req.user!.provedorId !== req.params.id) {
      throw new HttpError(403, "Acesso restrito ao proprio provedor");
    }
    const provedor = await prisma.provedor.findUnique({ where: { id: req.params.id } });
    if (!provedor) throw new HttpError(404, "Provedor nao encontrado");
    res.json(provedor);
  }),
);

provedoresRouter.post(
  "/",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = provedorSchema.parse(req.body);
    const provedor = await prisma.provedor.create({ data });
    res.status(201).json(provedor);
  }),
);

provedoresRouter.put(
  "/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = provedorSchema.partial().parse(req.body);
    const provedor = await prisma.provedor
      .update({ where: { id: req.params.id }, data })
      .catch(() => null);
    if (!provedor) throw new HttpError(404, "Provedor nao encontrado");
    res.json(provedor);
  }),
);

provedoresRouter.delete(
  "/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.provedor.delete({ where: { id: req.params.id } }).catch(() => {
      throw new HttpError(404, "Provedor nao encontrado");
    });
    res.status(204).send();
  }),
);
