import { Router } from "express";
import { z } from "zod";
import { OsStatus, UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as writeback from "../services/writebackService.js";

export const ordensServicoRouter = Router();

ordensServicoRouter.use(requireAuth);

async function assertAcesso(req: any, ordemServicoId: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");
  if (req.user.role === UserRole.PROVEDOR && os.provedorId !== req.user.provedorId) {
    throw new HttpError(403, "Acesso restrito ao proprio provedor");
  }
  return os;
}

ordensServicoRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const os = await prisma.ordemServico.findUnique({
      where: { id: req.params.id },
      include: { provedor: true, tipoOs: true, tecnico: true, atribuicoes: { orderBy: { atribuidoEm: "desc" } } },
    });
    res.json(os);
  }),
);

const acoesRoles = [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO];

ordensServicoRouter.post(
  "/:id/acaminho",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const os = await writeback.marcarACaminho(req.params.id);
    res.json(os);
  }),
);

const statusSchema = z.object({ status: z.nativeEnum(OsStatus) });

ordensServicoRouter.patch(
  "/:id/status",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { status } = statusSchema.parse(req.body);
    const os = await writeback.mudarStatus(req.params.id, status);
    res.json(os);
  }),
);

const anotacaoSchema = z.object({ texto: z.string().min(1).max(2000) });

ordensServicoRouter.post(
  "/:id/anotacoes",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { texto } = anotacaoSchema.parse(req.body);
    const os = await writeback.adicionarAnotacao(req.params.id, texto);
    res.json(os);
  }),
);

const atribuirSchema = z.object({ tecnicoId: z.string().uuid() });

ordensServicoRouter.post(
  "/:id/atribuir",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { tecnicoId } = atribuirSchema.parse(req.body);
    const os = await writeback.atribuirTecnico(req.params.id, tecnicoId, req.user!.sub);
    res.json(os);
  }),
);
