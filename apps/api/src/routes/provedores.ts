import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { chaveDoProvedor, gerarChaveEntrada, revogarChaveEntrada } from "../services/chaveParceiroService.js";
import { emitParaTodos } from "../services/realtimeHub.js";
import { exigirProvedor, provedoresDoUsuario } from "../services/escopoService.js";

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

/** Lista provedores. Admin ve todos; gestor, os do escopo dele; provedor, so o proprio. */
provedoresRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const lista = provedoresDoUsuario(req.user!);
    const where = lista ? { id: { in: lista } } : {};
    const provedores = await prisma.provedor.findMany({ where, orderBy: { nome: "asc" } });
    res.json(provedores);
  }),
);

provedoresRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    exigirProvedor(req.user!, req.params.id);
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
    const alvo = await prisma.provedor.findUnique({ where: { id: req.params.id }, select: { id: true, nome: true } });
    if (!alvo) throw new HttpError(404, "Provedor nao encontrado");

    await prisma.provedor.delete({ where: { id: req.params.id } });
    emitParaTodos({ tipo: "config-alterada", em: new Date().toISOString() });
    res.status(204).send();
  }),
);

/*
 * A chave da API de agendamento (`/api/parceiro/v1/agenda`), por provedor.
 * Qualquer sistema do provedor entra com ela — o AtendAI e um deles. Ver
 * `docs/api-agendamento.md`.
 */
const chaveParceiroSchema = z.object({ rotulo: z.string().trim().max(60).nullish() });

provedoresRouter.get(
  "/:id/chave-parceiro",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    res.json(await chaveDoProvedor(req.params.id));
  }),
);

/** Gera ou REGERA (a anterior morre na hora). Devolve em claro uma unica vez. */
provedoresRouter.post(
  "/:id/chave-parceiro",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const provedor = await prisma.provedor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!provedor) throw new HttpError(404, "Provedor nao encontrado");
    const { rotulo } = chaveParceiroSchema.parse(req.body ?? {});
    res.json({ chave: await gerarChaveEntrada(provedor.id, rotulo) });
  }),
);

provedoresRouter.delete(
  "/:id/chave-parceiro",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    await revogarChaveEntrada(req.params.id);
    res.status(204).end();
  }),
);
