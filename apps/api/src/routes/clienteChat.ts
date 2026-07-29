import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as clienteChatService from "../services/clienteChatService.js";

export const clienteChatRouter = Router();

clienteChatRouter.use(requireAuth);

/** PROVEDOR nunca participa — mesma fronteira do chat interno. */
clienteChatRouter.use((req, _res, next) => {
  if (req.user!.role === UserRole.PROVEDOR) throw new HttpError(403, "Chat com clientes nao disponivel para este papel");
  next();
});

/** Mesma trava do chat interno — por usuario, nao por IP. */
const enviarMensagemLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.sub,
  message: { error: "Muitas mensagens em pouco tempo. Aguarde um instante." },
});

clienteChatRouter.get(
  "/conversas",
  asyncHandler(async (req, res) => {
    const filtro = req.query.filtro;
    res.json(
      await clienteChatService.listarConversas({
        fila: filtro === "fila",
        agenteId: filtro === "minhas" ? req.user!.sub : undefined,
      }),
    );
  }),
);

clienteChatRouter.get(
  "/conversas/:conversaId/mensagens",
  asyncHandler(async (req, res) => {
    const antesDe = typeof req.query.antesDe === "string" ? req.query.antesDe : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await clienteChatService.listarMensagens(req.params.conversaId, antesDe, limit));
  }),
);

const enviarMensagemSchema = z.object({ corpo: z.string().trim().min(1).max(4000) });

clienteChatRouter.post(
  "/conversas/:conversaId/mensagens",
  enviarMensagemLimiter,
  asyncHandler(async (req, res) => {
    const { corpo } = enviarMensagemSchema.parse(req.body);
    res.json(await clienteChatService.enviarMensagem(req.params.conversaId, req.user!.sub, corpo));
  }),
);

clienteChatRouter.post(
  "/conversas/:conversaId/assumir",
  asyncHandler(async (req, res) => {
    await clienteChatService.assumir(req.params.conversaId, req.user!.sub);
    res.status(204).send();
  }),
);

const transferirSchema = z.object({ agenteId: z.string().min(1) });

clienteChatRouter.post(
  "/conversas/:conversaId/transferir",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { agenteId } = transferirSchema.parse(req.body);
    await clienteChatService.transferir(req.params.conversaId, agenteId);
    res.status(204).send();
  }),
);

clienteChatRouter.post(
  "/conversas/:conversaId/encerrar",
  asyncHandler(async (req, res) => {
    await clienteChatService.encerrar(req.params.conversaId);
    res.status(204).send();
  }),
);

/** Bytes de midia recebida do cliente — mesma ordem do chat interno (existencia antes do resto). */
clienteChatRouter.get(
  "/mensagens/:mensagemId/anexo",
  asyncHandler(async (req, res) => {
    const anexo = await clienteChatService.obterAnexo(req.params.mensagemId);
    if (!anexo) throw new HttpError(404, "Anexo nao encontrado");
    res.setHeader("Content-Type", anexo.mime);
    res.send(anexo.dados);
  }),
);
