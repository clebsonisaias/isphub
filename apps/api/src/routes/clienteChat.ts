import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { CanalWhatsapp, FILTROS_CONVERSA_CLIENTE, UserRole } from "@isphub/shared";
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

/**
 * Bem mais apertado que o de mensagens: cada disparo e um template PAGO pra um
 * numero que ainda nao falou com a gente. Um loop no cliente aqui custa
 * dinheiro e queima a qualidade do numero na Meta, nao so banda.
 */
const iniciarConversaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.sub,
  message: { error: "Muitos disparos de template em pouco tempo. Aguarde um instante." },
});

/**
 * `filtro` e enum validado: ausente ou invalido caia no default `todas`, que
 * NAO alarga nada — o escopo do papel entra por cima no servico (TECNICO so
 * enxerga o que iniciou). Antes, filtro ausente devolvia a caixa inteira.
 */
const listarConversasSchema = z.object({ filtro: z.enum(FILTROS_CONVERSA_CLIENTE).default("todas") });

clienteChatRouter.get(
  "/conversas",
  asyncHandler(async (req, res) => {
    const { filtro } = listarConversasSchema.parse(req.query);
    res.json(await clienteChatService.listarConversas(req.user!, filtro));
  }),
);

/** Catalogo HSM ao vivo da Meta — todo staff elegivel pode iniciar, logo todos leem. */
clienteChatRouter.get(
  "/templates",
  asyncHandler(async (_req, res) => {
    res.json(await clienteChatService.listarTemplates());
  }),
);

const iniciarConversaSchema = z.object({
  telefone: z.string().trim().min(8).max(20),
  nomeContato: z.string().trim().min(1).max(120).optional(),
  canal: z.nativeEnum(CanalWhatsapp),
  templateNome: z.string().trim().min(1).max(120),
  vars: z.record(z.string().trim().min(1).max(1000)).optional(),
});

clienteChatRouter.post(
  "/conversas",
  iniciarConversaLimiter,
  asyncHandler(async (req, res) => {
    const input = iniciarConversaSchema.parse(req.body);
    res.json(await clienteChatService.iniciarConversa(req.user!, input));
  }),
);

clienteChatRouter.get(
  "/conversas/:conversaId/mensagens",
  asyncHandler(async (req, res) => {
    await clienteChatService.exigirAcessoConversaCliente(req.user!, req.params.conversaId);
    const antesDe = typeof req.query.antesDe === "string" ? req.query.antesDe : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await clienteChatService.listarMensagens(req.params.conversaId, antesDe, limit));
  }),
);

const enviarMensagemSchema = z.object({ corpo: z.string().trim().min(1).max(4000) });

/**
 * INTERVENCAO: ADMIN/GESTOR passam no guard mesmo com a conversa atribuida a
 * outro atendente e escrevem sem trocar o dono (o servico nao toca em
 * `agenteId`). Trocar de dono continua sendo acao separada: /transferir.
 */
clienteChatRouter.post(
  "/conversas/:conversaId/mensagens",
  enviarMensagemLimiter,
  asyncHandler(async (req, res) => {
    await clienteChatService.exigirAcessoConversaCliente(req.user!, req.params.conversaId);
    const { corpo } = enviarMensagemSchema.parse(req.body);
    res.json(await clienteChatService.enviarMensagem(req.params.conversaId, req.user!.sub, corpo));
  }),
);

clienteChatRouter.post(
  "/conversas/:conversaId/assumir",
  asyncHandler(async (req, res) => {
    await clienteChatService.exigirAcessoConversaCliente(req.user!, req.params.conversaId);
    await clienteChatService.assumir(req.params.conversaId, req.user!.sub);
    res.status(204).send();
  }),
);

const transferirSchema = z.object({ agenteId: z.string().min(1) });

clienteChatRouter.post(
  "/conversas/:conversaId/transferir",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    await clienteChatService.exigirAcessoConversaCliente(req.user!, req.params.conversaId);
    const { agenteId } = transferirSchema.parse(req.body);
    await clienteChatService.transferir(req.params.conversaId, agenteId);
    res.status(204).send();
  }),
);

clienteChatRouter.post(
  "/conversas/:conversaId/encerrar",
  asyncHandler(async (req, res) => {
    await clienteChatService.exigirAcessoConversaCliente(req.user!, req.params.conversaId);
    await clienteChatService.encerrar(req.params.conversaId);
    res.status(204).send();
  }),
);

/**
 * Bytes de midia recebida do cliente. O escopo tem que ser resolvido pela
 * CONVERSA dona da mensagem: sem isso o vazamento fechado nas rotas acima
 * voltaria por aqui — bastaria o uuid da mensagem pra baixar a foto do cliente
 * de outro atendente. Mesmo precedente do garantirConversaDeOs no chat interno,
 * onde a porta dos fundos tinha mais poder que a da frente.
 */
clienteChatRouter.get(
  "/mensagens/:mensagemId/anexo",
  asyncHandler(async (req, res) => {
    const conversaId = await clienteChatService.conversaDaMensagem(req.params.mensagemId);
    // 404 tambem quando a mensagem nao existe: nao vira oraculo de ids.
    if (!conversaId) throw new HttpError(404, "Anexo nao encontrado");
    await clienteChatService.exigirAcessoConversaCliente(req.user!, conversaId);
    const anexo = await clienteChatService.obterAnexo(req.params.mensagemId);
    if (!anexo) throw new HttpError(404, "Anexo nao encontrado");
    res.setHeader("Content-Type", anexo.mime);
    res.send(anexo.dados);
  }),
);
