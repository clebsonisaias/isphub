import { Router } from "express";
import { CanalWhatsapp, MensagemClienteTipo } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { verificarAssinaturaMeta, verificarTokenEvolution } from "../lib/webhookSignature.js";
import * as canaisWhatsappService from "../services/canaisWhatsappService.js";
import * as clienteChatService from "../services/clienteChatService.js";
import * as whatsappMeta from "../connectors/whatsappMeta.js";
import * as confirmacaoVisitaService from "../services/confirmacaoVisitaService.js";

/**
 * PRIMEIRA ROTA VERDADEIRAMENTE PUBLICA do backend — sem requireAuth. Um
 * cliente de WhatsApp nunca tem como se autenticar como usuario ISPhub; quem
 * garante que o payload e legitimo e a verificacao de assinatura/token abaixo,
 * NAO um middleware de auth. Precisa do corpo CRU (rawBody) capturado por um
 * express.json proprio montado em app.ts ANTES do parser global — ver
 * comentario la.
 */
export const webhooksWhatsappRouter = Router();

/** Handshake da Meta: confirma que o servidor conhece o verify_token antes de aceitar o webhook. */
webhooksWhatsappRouter.get(
  "/meta",
  asyncHandler(async (req, res) => {
    const modo = req.query["hub.mode"];
    const tokenRecebido = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const config = await canaisWhatsappService.getConfig(CanalWhatsapp.META);
    if (modo === "subscribe" && config?.tipo === "meta" && tokenRecebido === config.verifyToken) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Verificacao falhou");
  }),
);

interface MetaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

function tipoMetaParaMensagemCliente(tipo: string): MensagemClienteTipo {
  switch (tipo) {
    case "image":
      return MensagemClienteTipo.IMAGEM;
    case "audio":
      return MensagemClienteTipo.AUDIO;
    case "document":
      return MensagemClienteTipo.DOCUMENTO;
    case "location":
      return MensagemClienteTipo.LOCALIZACAO;
    default:
      return MensagemClienteTipo.TEXTO;
  }
}

webhooksWhatsappRouter.post(
  "/meta",
  asyncHandler(async (req, res) => {
    // Responde 200 rapido sempre — a Meta reentrega agressivamente se nao ver 2xx.
    res.status(200).send("ok");

    const config = await canaisWhatsappService.getConfig(CanalWhatsapp.META);
    if (!config || config.tipo !== "meta") return; // canal desligado — ignora silenciosamente

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const assinatura = req.header("x-hub-signature-256");
    if (!rawBody || !verificarAssinaturaMeta(rawBody, assinatura, config.appSecret)) {
      console.warn("[webhook-meta] assinatura invalida — payload ignorado");
      return;
    }

    try {
      const entradas = req.body?.entry ?? [];
      for (const entrada of entradas) {
        for (const mudanca of entrada.changes ?? []) {
          const valor = mudanca.value;
          const nomeContato = valor?.contacts?.[0]?.profile?.name ?? null;
          for (const msg of (valor?.messages ?? []) as MetaMessage[]) {
            const tipo = tipoMetaParaMensagemCliente(msg.type);
            let midia: { dados: Buffer; mime: string } | null = null;
            const mediaRef = msg.image ?? msg.audio ?? msg.document;
            if (mediaRef) {
              try {
                midia = await whatsappMeta.baixarMidia(config, mediaRef.id);
              } catch {
                midia = null; // segue sem midia (placeholder) em vez de derrubar o webhook inteiro
              }
            }
            const corpoInterativo = msg.interactive?.button_reply?.id ?? msg.interactive?.button_reply?.title;
            const corpo = corpoInterativo ?? msg.text?.body ?? msg.image?.caption ?? null;

            await clienteChatService.receberMensagemWebhook({
              canal: CanalWhatsapp.META,
              telefone: msg.from,
              nomeContato,
              waMessageId: msg.id,
              tipo,
              corpo: msg.interactive?.button_reply?.title ?? corpo,
              midia,
              lat: msg.location?.latitude ?? null,
              lng: msg.location?.longitude ?? null,
            });

            if (corpo) {
              void confirmacaoVisitaService
                .tratarRespostaConfirmacao(undefined, msg.from, corpo)
                .catch((err) => console.warn("[webhook-meta] erro ao tratar confirmacao:", err));
            }
          }
        }
      }
    } catch (err) {
      // Falha na ingestao NUNCA vira timeout do webhook (ja respondemos 200 acima) — so loga.
      console.error("[webhook-meta] falha ao processar payload:", err instanceof Error ? err.message : err);
    }
  }),
);

/**
 * Formato do payload/auth da Evolution API varia por versao/config da
 * instancia — best-effort contra o formato publico documentado
 * (github.com/EvolutionAPI/evolution-api, evento "messages.upsert").
 * PRECISA ser confirmado contra a instancia real antes de confiar em producao
 * (ver plano).
 */
webhooksWhatsappRouter.post(
  "/evolution",
  asyncHandler(async (req, res) => {
    res.status(200).send("ok");

    const config = await canaisWhatsappService.getConfig(CanalWhatsapp.EVOLUTION);
    if (!config || config.tipo !== "evolution") return;

    const headerAuth = req.header("apikey") ?? req.header("authorization");
    if (!verificarTokenEvolution(headerAuth, config.apiKey)) {
      console.warn("[webhook-evolution] token invalido — payload ignorado");
      return;
    }

    try {
      const data = req.body?.data;
      if (!data || data.key?.fromMe) return; // ignora eco de mensagens enviadas por nos mesmos

      const telefone = String(data.key?.remoteJid ?? "").split("@")[0];
      if (!telefone) return;
      const waMessageId = data.key?.id;
      if (!waMessageId) return;

      const corpo = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? null;
      const base64Imagem = data.message?.imageMessage?.base64 ?? null;
      const midia = base64Imagem
        ? { dados: Buffer.from(base64Imagem, "base64"), mime: data.message?.imageMessage?.mimetype ?? "image/jpeg" }
        : null;

      await clienteChatService.receberMensagemWebhook({
        canal: CanalWhatsapp.EVOLUTION,
        telefone,
        nomeContato: data.pushName ?? null,
        waMessageId,
        tipo: midia ? MensagemClienteTipo.IMAGEM : MensagemClienteTipo.TEXTO,
        corpo,
        midia,
      });

      if (corpo) {
        void confirmacaoVisitaService
          .tratarRespostaConfirmacao(undefined, telefone, corpo)
          .catch((err) => console.warn("[webhook-evolution] erro ao tratar confirmacao:", err));
      }
    } catch (err) {
      console.error("[webhook-evolution] falha ao processar payload:", err instanceof Error ? err.message : err);
    }
  }),
);
