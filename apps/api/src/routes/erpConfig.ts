import { Router } from "express";
import { z } from "zod";
import { UserRole, type ErpConfigPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import { buildConnector } from "../services/erpConnectorService.js";

export const erpConfigRouter = Router({ mergeParams: true });

erpConfigRouter.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.GESTOR));

/**
 * Valida a URL base do SGP. `z.string().url()` sozinho e literalmente
 * `new URL(input)` — aceitava `file://`, `gopher://`, `http://localhost:5432`,
 * `http://169.254.169.254/` e credencial embutida. Como o servidor busca essa
 * URL (no /testar, nas rotas de conexao/fttx e no scheduler), isso era um SSRF:
 * varredura da rede interna do container a partir de dentro.
 *
 * O FRAGMENTO era o pior detalhe: `baseUrl()` so tira a barra final, entao
 * `http://alvo/qualquer/caminho#` empurrava o `/api/os/...` que o conector
 * concatena pra DENTRO do fragmento — dando controle total do path final.
 */
function validarUrlSgp(valor: string, ctx: z.RefinementCtx): void {
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL invalida" });
    return;
  }

  const recusar = (motivo: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: motivo });

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    recusar("A URL do SGP precisa ser http:// ou https://");
    return;
  }
  if (u.username || u.password) recusar("Nao use usuario/senha embutidos na URL");
  if (u.hash) recusar("A URL do SGP nao pode conter fragmento (#)");
  if (u.search) recusar("A URL do SGP nao pode conter query string");

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || // link-local: metadata de nuvem
    /^f[cd][0-9a-f]{2}:/.test(host) || // IPv6 unique-local
    /^fe80:/.test(host) // IPv6 link-local
  ) {
    recusar("Endereco interno/privado nao e permitido para o SGP");
  }
}

const erpConfigSchema = z.object({
  tipo: z.literal("SGP").default("SGP"),
  url: z.string().url().superRefine(validarUrlSgp),
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
