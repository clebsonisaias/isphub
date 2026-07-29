import { CanalWhatsapp, type CanalWhatsappConfigInput, type CanalWhatsappConfigPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import * as whatsappMeta from "../connectors/whatsappMeta.js";
import * as whatsappEvolution from "../connectors/whatsappEvolution.js";

/** Campos secretos por tipo — mascarados na resposta, nunca reenviados ao cliente. */
const CAMPOS_SECRETOS: Record<CanalWhatsapp, string[]> = {
  [CanalWhatsapp.META]: ["accessToken", "appSecret", "verifyToken"],
  [CanalWhatsapp.EVOLUTION]: ["apiKey"],
};

export interface MetaWhatsappConfig {
  tipo: "meta";
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  /** So o catalogo de templates precisa dele; envio de texto usa phoneNumberId. Nao e segredo (fora de CAMPOS_SECRETOS). */
  wabaId?: string;
}

export interface EvolutionWhatsappConfig {
  tipo: "evolution";
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

export type CanalWhatsappConfigParsed = MetaWhatsappConfig | EvolutionWhatsappConfig;

/** Decifra + faz parse do config de um canal. null se nao configurado ou corrompido. */
export async function getConfig(tipo: CanalWhatsapp): Promise<CanalWhatsappConfigParsed | null> {
  const row = await prisma.canalWhatsappConfig.findUnique({ where: { tipo } });
  if (!row || !row.ativo) return null;
  try {
    return JSON.parse(decrypt(row.configCifrado)) as CanalWhatsappConfigParsed;
  } catch {
    return null;
  }
}

/** Re-cifra o blob inteiro a cada save — mesma convencao do ErpConfig (nunca merge parcial em cima do cifrado). */
export async function upsertConfig(tipo: CanalWhatsapp, data: CanalWhatsappConfigInput): Promise<CanalWhatsappConfigPublic> {
  const configCifrado = encrypt(JSON.stringify(data));
  const row = await prisma.canalWhatsappConfig.upsert({
    where: { tipo },
    create: { tipo, configCifrado },
    update: { configCifrado },
  });
  // Trocar wabaId/accessToken sem isso serviria o catalogo do WABA antigo por ate 5 min.
  if (tipo === CanalWhatsapp.META) whatsappMeta.limparCacheTemplates();
  return toPublic({ ...row, tipo: row.tipo as CanalWhatsapp });
}

export async function listarConfigs(): Promise<CanalWhatsappConfigPublic[]> {
  const tipos = Object.values(CanalWhatsapp);
  const rows = await prisma.canalWhatsappConfig.findMany({ where: { tipo: { in: tipos } } });
  const porTipo = new Map(rows.map((r) => [r.tipo, r]));
  return tipos.map((tipo) => {
    const row = porTipo.get(tipo);
    return row
      ? toPublic({ ...row, tipo: row.tipo as CanalWhatsapp })
      : { tipo, configurado: false, ativo: false, campos: {}, ultimaVerificacaoEm: null, ultimaVerificacaoOk: null, ultimaVerificacaoMensagem: null };
  });
}

function toPublic(row: {
  tipo: CanalWhatsapp;
  configCifrado: string;
  ativo: boolean;
  ultimaVerificacaoEm: Date | null;
  ultimaVerificacaoOk: boolean | null;
  ultimaVerificacaoMensagem: string | null;
}): CanalWhatsappConfigPublic {
  const campos: Record<string, string> = {};
  try {
    const parsed = JSON.parse(decrypt(row.configCifrado)) as Record<string, unknown>;
    const secretos = new Set(CAMPOS_SECRETOS[row.tipo]);
    for (const [chave, valor] of Object.entries(parsed)) {
      if (chave === "tipo" || typeof valor !== "string") continue;
      campos[chave] = secretos.has(chave) ? maskToken(valor) : valor;
    }
  } catch {
    // config corrompida — nao interrompe a listagem, so nao mostra campos
  }
  return {
    tipo: row.tipo,
    configurado: true,
    ativo: row.ativo,
    campos,
    ultimaVerificacaoEm: row.ultimaVerificacaoEm?.toISOString() ?? null,
    ultimaVerificacaoOk: row.ultimaVerificacaoOk,
    ultimaVerificacaoMensagem: row.ultimaVerificacaoMensagem,
  };
}

/** Testa a conexao com o canal usando as credenciais salvas (segredo nunca sai da API). */
export async function testarConexao(tipo: CanalWhatsapp): Promise<{ ok: boolean; message?: string }> {
  const config = await getConfig(tipo);
  if (!config) throw new HttpError(404, "Canal nao configurado");

  const resultado = tipo === CanalWhatsapp.META ? await whatsappMeta.testarConexao(config as MetaWhatsappConfig) : await whatsappEvolution.testarConexao(config as EvolutionWhatsappConfig);

  await prisma.canalWhatsappConfig.update({
    where: { tipo },
    data: {
      ultimaVerificacaoEm: new Date(),
      ultimaVerificacaoOk: resultado.ok,
      ultimaVerificacaoMensagem: resultado.message ?? (resultado.ok ? "Conexao OK" : null),
    },
  });

  return resultado;
}
