import { Router } from "express";
import { z } from "zod";
import { CanalWhatsapp } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { UserRole } from "@isphub/shared";
import { validarUrlExterna } from "../lib/urlValidation.js";
import * as canaisWhatsappService from "../services/canaisWhatsappService.js";

export const canaisWhatsappRouter = Router();

/**
 * ADMIN only (nao GESTOR, diferente do ErpConfig) — mais sensivel que
 * credenciais de SGP: vazamento do app secret da Meta permite forjar
 * webhooks assinados pra toda a operacao, nao so um provedor.
 */
canaisWhatsappRouter.use(requireAuth, requireRole(UserRole.ADMIN));

const metaSchema = z.object({
  tipo: z.literal("meta"),
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  verifyToken: z.string().min(8),
  appSecret: z.string().min(1),
  // Opcional (canal ja configurado nao pode virar invalido por causa dele), mas
  // precisa estar AQUI: o zod descarta chave nao declarada, e o blob cifrado e
  // escrito a partir do objeto ja validado — sem esta linha o WABA ID enviado
  // pela tela seria silenciosamente jogado fora e o catalogo de templates
  // responderia "configure o WABA ID" pra sempre.
  wabaId: z.string().trim().min(1).optional(),
});

const evolutionSchema = z.object({
  tipo: z.literal("evolution"),
  baseUrl: z.string().url().superRefine(validarUrlExterna),
  apiKey: z.string().min(1),
  instanceName: z.string().min(1),
});

const configSchema = z.discriminatedUnion("tipo", [metaSchema, evolutionSchema]);

function tipoParaEnum(tipo: string): CanalWhatsapp {
  if (tipo === "meta") return CanalWhatsapp.META;
  if (tipo === "evolution") return CanalWhatsapp.EVOLUTION;
  throw new HttpError(400, "Tipo de canal invalido");
}

canaisWhatsappRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await canaisWhatsappService.listarConfigs());
  }),
);

canaisWhatsappRouter.put(
  "/:tipo",
  asyncHandler(async (req, res) => {
    const tipo = tipoParaEnum(req.params.tipo);
    const data = configSchema.parse({ ...req.body, tipo: req.params.tipo });
    res.json(await canaisWhatsappService.upsertConfig(tipo, data));
  }),
);

canaisWhatsappRouter.post(
  "/:tipo/testar",
  asyncHandler(async (req, res) => {
    const tipo = tipoParaEnum(req.params.tipo);
    res.json(await canaisWhatsappService.testarConexao(tipo));
  }),
);
