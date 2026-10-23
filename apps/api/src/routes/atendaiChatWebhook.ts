import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../middleware/errorHandler.js";
import { receberAviso } from "../services/ponteChatAtendaiService.js";

/**
 * `POST /api/atendai/chat/:provedorId` — o AtendAI avisa mensagem nova no chat
 * interno (webhook cadastrado no "Ligar chat"). Publica, mas so aceita corpo
 * com a assinatura HMAC do segredo do provedor; por isso le o corpo CRU (a
 * assinatura e sobre os bytes exatos) e fica montada antes do parser global.
 */
export const atendaiChatWebhookRouter = Router();

atendaiChatWebhookRouter.post(
  "/:provedorId",
  rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }),
  express.raw({ type: "*/*", limit: "256kb" }),
  asyncHandler(async (req, res) => {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const r = await receberAviso(req.params.provedorId!, corpo, req.get("X-AtendeHub-Signature") ?? undefined);
    if (r === "assinatura") return void res.status(401).json({ error: "Assinatura invalida" });
    res.json({ ok: true, resultado: r });
  }),
);
