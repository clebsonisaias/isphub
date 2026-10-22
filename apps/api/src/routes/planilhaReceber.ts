import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { verificarIdTokenGoogle } from "../lib/googleIdToken.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { processarPlanilha } from "../services/planilhaSyncService.js";

/**
 * `POST /api/planilha/receber` — o Apps Script da conta Google que enxerga a
 * planilha de agendamento manda o .xlsx cru aqui a cada 15 min.
 *
 * Quem chama se prova de um de dois jeitos, ambos independentes da chave isk_
 * do parceiro ("Ligar agendamento" regera a isk_ e derrubaria o robo junto):
 *  - **identidade Google** (preferido): o script manda `ScriptApp.getIdentityToken()`
 *    e o e-mail tem de estar em PLANILHA_SYNC_EMAILS — nenhum segredo a guardar;
 *  - **segredo** PLANILHA_SYNC_TOKEN, pra quem nao puder usar a identidade.
 * O provedor vem da env, nunca do pedido. Sem as envs, a rota nem existe (404).
 */

/** Comparacao em tempo constante; segredo curto demais conta como nao configurado. */
export function tokenConfere(recebido: string | undefined, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < 32 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const planilhaReceberRouter = Router();

// O script manda 1 vez a cada 15 min; 10/min ja e folga e trava tentativa de segredo.
planilhaReceberRouter.use(rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));

planilhaReceberRouter.post(
  "/receber",
  express.raw({ type: () => true, limit: "5mb" }),
  asyncHandler(async (req, res) => {
    const emails = (env.PLANILHA_SYNC_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!env.PLANILHA_SYNC_PROVEDOR || (!env.PLANILHA_SYNC_TOKEN && emails.length === 0)) {
      res.status(404).end();
      return;
    }
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    let autorizado = tokenConfere(token, env.PLANILHA_SYNC_TOKEN);
    if (!autorizado && emails.length) {
      const id = await verificarIdTokenGoogle(token);
      autorizado = !!id && emails.includes(id.email) && (!env.PLANILHA_SYNC_AUD || id.aud === env.PLANILHA_SYNC_AUD);
      if (id && !autorizado) console.warn(`[planilha-sync] identidade recusada: ${id.email} (aud ${id.aud})`);
    }
    if (!autorizado) {
      res.status(401).json({ error: "não autorizado" });
      return;
    }
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 100) {
      res.status(400).json({ error: "corpo vazio: mande o .xlsx cru (application/octet-stream)" });
      return;
    }
    const r = await processarPlanilha(buf, env.PLANILHA_SYNC_PROVEDOR);
    // So numeros de OS e motivos — nada de nome/telefone de cliente sai daqui.
    res.json({
      pulada: r.pulada,
      lidas: r.lidas,
      marcadas: r.marcadas,
      desmarcadas: r.desmarcadas,
      recusadas: r.recusadas,
      conflitos: r.conflitos,
      ignoradas: r.ignoradas.length,
      trava: r.trava,
      erro: r.erro,
    });
  }),
);
