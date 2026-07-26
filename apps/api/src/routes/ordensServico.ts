import { Router } from "express";
import { z } from "zod";
import { OsStatus, UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { podeAcessarOs } from "../services/escopoService.js";
import * as writeback from "../services/writebackService.js";

export const ordensServicoRouter = Router();

ordensServicoRouter.use(requireAuth);

async function assertAcesso(req: any, ordemServicoId: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");
  if (!podeAcessarOs(req.user, os)) {
    throw new HttpError(403, "Acesso restrito ao proprio provedor/tecnico");
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
    const os = await writeback.marcarACaminho(req.params.id, req.user!.sub);
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
    const os = await writeback.mudarStatus(req.params.id, status, req.user!.sub);
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
    const os = await writeback.adicionarAnotacao(req.params.id, texto, req.user!.sub);
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

/** Timeline da OS: status, anotacoes, atribuicoes e fotos, mais recentes primeiro. */
ordensServicoRouter.get(
  "/:id/eventos",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const eventos = await prisma.osEvento.findMany({
      where: { ordemServicoId: req.params.id },
      include: { autor: { select: { nome: true } } },
      orderBy: { criadoEm: "desc" },
    });
    res.json(
      eventos.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        autorNome: e.autor?.nome ?? null,
        descricao: e.descricao,
        evidenciaId: e.evidenciaId,
        criadoEm: e.criadoEm,
      })),
    );
  }),
);

const MIME_TYPES_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;
const EVIDENCIA_TAMANHO_MAX_BYTES = 2 * 1024 * 1024;

const evidenciaSchema = z.object({
  /** Base64 puro, sem o prefixo "data:...;base64,". Comprimida no cliente antes do envio. */
  dados: z.string().min(1),
  mimeType: z.enum(MIME_TYPES_PERMITIDOS),
  legenda: z.string().max(500).optional(),
});

const EVIDENCIA_RESUMO_SELECT = {
  id: true,
  legenda: true,
  mimeType: true,
  tamanhoBytes: true,
  criadoEm: true,
  autor: { select: { nome: true } },
} as const;

/** Foto de evidencia anexada a OS — local-only na ISPhub, sem write-back ao SGP (ver plano). */
ordensServicoRouter.post(
  "/:id/evidencias",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { dados, mimeType, legenda } = evidenciaSchema.parse(req.body);

    const buffer = Buffer.from(dados, "base64");
    if (buffer.length === 0) throw new HttpError(400, "Arquivo vazio ou base64 invalido");
    if (buffer.length > EVIDENCIA_TAMANHO_MAX_BYTES) {
      throw new HttpError(400, `Foto maior que o limite de ${EVIDENCIA_TAMANHO_MAX_BYTES / 1024 / 1024}MB`);
    }

    const autorId = req.user!.sub;
    const evidencia = await prisma.evidencia.create({
      data: { ordemServicoId: req.params.id, autorId, legenda, mimeType, tamanhoBytes: buffer.length, dados: buffer },
      select: EVIDENCIA_RESUMO_SELECT,
    });
    await prisma.osEvento.create({
      data: {
        ordemServicoId: req.params.id,
        tipo: "foto",
        autorId,
        descricao: legenda ? `Foto adicionada: ${legenda}` : "Foto adicionada",
        evidenciaId: evidencia.id,
      },
    });

    const { autor, ...resto } = evidencia;
    res.status(201).json({ ...resto, autorNome: autor?.nome ?? null });
  }),
);

ordensServicoRouter.get(
  "/:id/evidencias",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const evidencias = await prisma.evidencia.findMany({
      where: { ordemServicoId: req.params.id },
      select: EVIDENCIA_RESUMO_SELECT,
      orderBy: { criadoEm: "desc" },
    });
    res.json(
      evidencias.map(({ autor, ...resto }) => ({ ...resto, autorNome: autor?.nome ?? null })),
    );
  }),
);

ordensServicoRouter.get(
  "/:id/evidencias/:evidenciaId/arquivo",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const evidencia = await prisma.evidencia.findFirst({
      where: { id: req.params.evidenciaId, ordemServicoId: req.params.id },
    });
    if (!evidencia) throw new HttpError(404, "Evidencia nao encontrada");
    res.setHeader("Content-Type", evidencia.mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    // evidencia.dados vem do Prisma como Uint8Array, nao Buffer — res.send
    // so manda bytes crus se reconhecer Buffer.isBuffer, senao cai no
    // fallback de serializar como JSON (o bug que isso corrige).
    res.send(Buffer.from(evidencia.dados));
  }),
);
