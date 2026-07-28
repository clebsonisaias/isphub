import { Router } from "express";
import { z } from "zod";
import { MensagemTipo, UserRole } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as chatService from "../services/chatService.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

/** PROVEDOR nunca chega no chat — bloqueado antes de qualquer rota abaixo. */
chatRouter.use((req, _res, next) => {
  if (req.user!.role === UserRole.PROVEDOR) throw new HttpError(403, "Chat nao disponivel para este papel");
  next();
});

chatRouter.get(
  "/contatos",
  asyncHandler(async (req, res) => {
    res.json(await chatService.listarContatos(req.user!.sub));
  }),
);

chatRouter.get(
  "/conversas",
  asyncHandler(async (req, res) => {
    res.json(await chatService.listarConversas(req.user!.sub));
  }),
);

/** Endpoint leve pro badge do sino do chat — so o total, sem montar as conversas. */
chatRouter.get(
  "/conversas/nao-lidas",
  asyncHandler(async (req, res) => {
    res.json({ naoLidas: await chatService.contarNaoLidas(req.user!.sub) });
  }),
);

const criarDiretaSchema = z.object({ usuarioId: z.string().min(1) });

chatRouter.post(
  "/conversas/direta",
  asyncHandler(async (req, res) => {
    const { usuarioId } = criarDiretaSchema.parse(req.body);
    res.status(201).json(await chatService.criarOuObterConversaDireta(req.user!.sub, usuarioId));
  }),
);

const criarGrupoSchema = z.object({
  titulo: z.string().trim().min(1).max(80),
  participanteIds: z.array(z.string().min(1)).min(1),
});

chatRouter.post(
  "/conversas/grupo",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { titulo, participanteIds } = criarGrupoSchema.parse(req.body);
    res.status(201).json(await chatService.criarConversaGrupo(titulo, participanteIds, req.user!.sub));
  }),
);

chatRouter.post(
  "/conversas/os/:ordemServicoId",
  asyncHandler(async (req, res) => {
    res.status(201).json(await chatService.garantirConversaDeOs(req.params.ordemServicoId, req.user!.sub));
  }),
);

const listarMensagensSchema = z.object({
  antesDe: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

chatRouter.get(
  "/conversas/:conversaId/mensagens",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { antesDe, limit } = listarMensagensSchema.parse(req.query);
    res.json(await chatService.listarMensagens(req.params.conversaId, antesDe, limit));
  }),
);

const enviarMensagemSchema = z.object({
  tipo: z.nativeEnum(MensagemTipo).default(MensagemTipo.TEXTO),
  corpo: z.string().trim().min(1).max(4000).optional(),
  anexoBase64: z.string().optional(),
  anexoMime: z.string().optional(),
  duracaoSeg: z.number().int().positive().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  ordemServicoRefId: z.string().optional(),
  respondendoAId: z.string().optional(),
});

chatRouter.post(
  "/conversas/:conversaId/mensagens",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const input = enviarMensagemSchema.parse(req.body);
    res.status(201).json(await chatService.enviarMensagem(req.params.conversaId, req.user!.sub, input));
  }),
);

chatRouter.post(
  "/conversas/:conversaId/leitura",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    await chatService.marcarLida(req.params.conversaId, req.user!.sub);
    res.status(204).send();
  }),
);

chatRouter.post(
  "/conversas/:conversaId/digitando",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    await chatService.emitirDigitando(req.params.conversaId, req.user!.sub);
    res.status(204).send();
  }),
);

const respostaRapidaSchema = z.object({
  tipo: z.enum(["a_caminho", "cheguei", "cliente_ausente", "preciso_apoio"]),
});

chatRouter.post(
  "/conversas/:conversaId/os/resposta-rapida",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { tipo } = respostaRapidaSchema.parse(req.body);
    res.status(201).json(await chatService.aplicarRespostaRapidaOs(req.params.conversaId, tipo, req.user!.sub));
  }),
);

const reagirSchema = z.object({ emoji: z.string().trim().min(1).max(8) });

chatRouter.post(
  "/conversas/:conversaId/mensagens/:mensagemId/reagir",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { emoji } = reagirSchema.parse(req.body);
    await chatService.reagir(req.params.mensagemId, req.user!.sub, emoji);
    res.status(204).send();
  }),
);

const editarMensagemSchema = z.object({ corpo: z.string().trim().min(1).max(4000) });

chatRouter.patch(
  "/conversas/:conversaId/mensagens/:mensagemId",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { corpo } = editarMensagemSchema.parse(req.body);
    res.json(await chatService.editarMensagem(req.params.mensagemId, req.user!.sub, corpo));
  }),
);

chatRouter.delete(
  "/conversas/:conversaId/mensagens/:mensagemId",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const ehAdmin = req.user!.role === UserRole.ADMIN;
    await chatService.apagarMensagem(req.params.mensagemId, req.user!.sub, ehAdmin);
    res.status(204).send();
  }),
);
