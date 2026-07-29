import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { registrarToken, removerToken } from "../services/pushService.js";

export const notificacoesRouter = Router();

notificacoesRouter.use(requireAuth);

const registrarPushSchema = z.object({
  token: z.string().min(1).max(200),
  plataforma: z.enum(["android", "ios"]),
});

/**
 * Registra o aparelho pra receber push. O app chama a cada abertura (o token do
 * Expo pode rotacionar), entao e idempotente de proposito.
 */
notificacoesRouter.post(
  "/push/registrar",
  asyncHandler(async (req, res) => {
    const { token, plataforma } = registrarPushSchema.parse(req.body);
    try {
      await registrarToken(req.user!.sub, token, plataforma);
    } catch {
      // So o formato do token pode falhar aqui — e culpa do cliente, nao 500.
      throw new HttpError(400, "Token de push invalido");
    }
    res.status(204).send();
  }),
);

/**
 * Desregistra o aparelho (logout). Sem body: o token vai na URL pra caber num
 * `navigator.sendBeacon`/keepalive no futuro, se o logout virar assincrono.
 */
notificacoesRouter.delete(
  "/push/:token",
  asyncHandler(async (req, res) => {
    await removerToken(req.params.token);
    res.status(204).send();
  }),
);

/** Endpoint leve pro polling do sino — so o numero, sem a lista inteira. */
notificacoesRouter.get(
  "/contagem",
  asyncHandler(async (req, res) => {
    const naoLidas = await prisma.notificacao.count({ where: { usuarioId: req.user!.sub, lida: false } });
    res.json({ naoLidas });
  }),
);

const listarSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

notificacoesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { limit } = listarSchema.parse(req.query);
    const notificacoes = await prisma.notificacao.findMany({
      where: { usuarioId: req.user!.sub },
      orderBy: { criadoEm: "desc" },
      take: limit,
    });
    res.json(notificacoes);
  }),
);

notificacoesRouter.post(
  "/:id/lida",
  asyncHandler(async (req, res) => {
    const { count } = await prisma.notificacao.updateMany({
      where: { id: req.params.id, usuarioId: req.user!.sub },
      data: { lida: true },
    });
    if (count === 0) throw new HttpError(404, "Notificacao nao encontrada");
    res.status(204).send();
  }),
);

notificacoesRouter.post(
  "/marcar-todas-lidas",
  asyncHandler(async (req, res) => {
    await prisma.notificacao.updateMany({
      where: { usuarioId: req.user!.sub, lida: false },
      data: { lida: true },
    });
    res.status(204).send();
  }),
);
