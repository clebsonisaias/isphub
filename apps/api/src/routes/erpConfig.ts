import { Router } from "express";
import { z } from "zod";
import { UserRole, type ErpConfigPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import { validarUrlExterna } from "../lib/urlValidation.js";
import { buildConnector } from "../services/erpConnectorService.js";

export const erpConfigRouter = Router({ mergeParams: true });

erpConfigRouter.use(requireAuth, requireRole(UserRole.ADMIN));

const erpConfigSchema = z.object({
  tipo: z.literal("SGP").default("SGP"),
  url: z.string().url().superRefine(validarUrlExterna),
  app: z.string().min(1),
  token: z.string().min(8),
  intervaloPollingSegundos: z.number().int().min(30).max(3600).optional(),
});

function toPublic(row: {
  id: string;
  provedorId: string;
  tipo: string;
  url: string;
  app: string;
  tokenCifrado: string;
  intervaloPollingSegundos: number;
  ativo: boolean;
  ultimaSyncEm: Date | null;
  ultimaSyncOk: boolean | null;
  ultimaSyncMensagem: string | null;
}): ErpConfigPublic {
  let tokenMascarado = "****";
  try {
    tokenMascarado = maskToken(decrypt(row.tokenCifrado));
  } catch {
    // token corrompido/ilegivel — nao interrompe a listagem, so nao mascara de forma util
  }
  return {
    id: row.id,
    provedorId: row.provedorId,
    tipo: row.tipo as ErpConfigPublic["tipo"],
    url: row.url,
    app: row.app,
    tokenMascarado,
    intervaloPollingSegundos: row.intervaloPollingSegundos,
    ativo: row.ativo,
    ultimaSyncEm: row.ultimaSyncEm?.toISOString() ?? null,
    ultimaSyncOk: row.ultimaSyncOk,
    ultimaSyncMensagem: row.ultimaSyncMensagem,
  };
}

/** Busca a config e garante que pertence ao provedor da rota. */
async function getConfigOrThrow(provedorId: string) {
  const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP" } });
  if (!config) throw new HttpError(404, "Integracao SGP nao configurada para este provedor");
  return config;
}

erpConfigRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const config = await prisma.erpConfig.findFirst({ where: { provedorId: req.params.provedorId, tipo: "SGP" } });
    if (!config) return res.status(404).json({ error: "Integracao SGP nao configurada para este provedor" });
    res.json(toPublic(config));
  }),
);

/** Cria ou substitui a configuracao SGP do provedor (token sempre re-cifrado). */
erpConfigRouter.put(
  "/",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = erpConfigSchema.parse(req.body);
    const tokenCifrado = encrypt(data.token);

    const config = await prisma.erpConfig.upsert({
      where: { provedorId_tipo: { provedorId: req.params.provedorId, tipo: "SGP" } },
      create: {
        provedorId: req.params.provedorId,
        tipo: "SGP",
        url: data.url,
        app: data.app,
        tokenCifrado,
        intervaloPollingSegundos: data.intervaloPollingSegundos ?? 180,
      },
      update: {
        url: data.url,
        app: data.app,
        tokenCifrado,
        ...(data.intervaloPollingSegundos ? { intervaloPollingSegundos: data.intervaloPollingSegundos } : {}),
      },
    });

    res.json(toPublic(config));
  }),
);

/** Testa a conexao com o SGP usando as credenciais salvas (token nunca sai da API). */
erpConfigRouter.post(
  "/testar",
  asyncHandler(async (req, res) => {
    const config = await getConfigOrThrow(req.params.provedorId);
    const connector = buildConnector(config);
    const resultado = await connector.testConnection();

    await prisma.erpConfig.update({
      where: { id: config.id },
      data: {
        ultimaSyncEm: new Date(),
        ultimaSyncOk: resultado.ok,
        ultimaSyncMensagem: resultado.message ?? (resultado.ok ? "Conexao OK" : null),
      },
    });

    res.json(resultado);
  }),
);
