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
        criadoEm: e.criadoEm,
      })),
    );
  }),
);

const EVIDENCIA_TAMANHO_MAX_BYTES = 2 * 1024 * 1024;
const MIME_TYPES_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;

const evidenciaSchema = z.object({
  /** Base64 puro, sem o prefixo "data:...;base64,". Comprimida no cliente antes do envio. */
  dados: z.string().min(1),
  mimeType: z.enum(MIME_TYPES_PERMITIDOS),
  legenda: z.string().max(500).optional(),
});

/**
 * Fotos de evidencia sao hospedadas no proprio SGP (nao ha storage local) —
 * essas 3 rotas so validam/repassam pro conector; ver writebackService.ts.
 */
ordensServicoRouter.post(
  "/:id/evidencias",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { dados, legenda } = evidenciaSchema.parse(req.body);

    // So valida o tamanho antes de mandar pro SGP (mimeType em si o SGP nao pede).
    const tamanhoBytes = Buffer.byteLength(dados, "base64");
    if (tamanhoBytes === 0) throw new HttpError(400, "Arquivo vazio ou base64 invalido");
    if (tamanhoBytes > EVIDENCIA_TAMANHO_MAX_BYTES) {
      throw new HttpError(400, `Foto maior que o limite de ${EVIDENCIA_TAMANHO_MAX_BYTES / 1024 / 1024}MB`);
    }

    const imagens = await writeback.adicionarEvidencia(req.params.id, dados, req.user!.sub, legenda);
    res.status(201).json(imagens);
  }),
);

ordensServicoRouter.get(
  "/:id/evidencias",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    res.json(await writeback.listarEvidencias(req.params.id));
  }),
);

ordensServicoRouter.get(
  "/:id/evidencias/:anexoId/arquivo",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const arquivo = await writeback.obterArquivoEvidencia(req.params.id, req.params.anexoId);
    if (!arquivo) throw new HttpError(404, "Evidencia nao encontrada");
    res.setHeader("Content-Type", arquivo.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(arquivo.bytes));
  }),
);
