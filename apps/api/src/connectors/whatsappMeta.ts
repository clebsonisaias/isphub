/**
 * Adapter para o Meta WhatsApp Cloud API (oficial). Mesmas convencoes do
 * connector do SGP (sgp.ts): TIMEOUT_MS + AbortSignal.timeout, erro tipado
 * com corpo truncado, nunca logar o accessToken/appSecret em claro.
 */

const TIMEOUT_MS = 15_000;
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export class MetaWhatsappError extends Error {}

interface MetaConfig {
  phoneNumberId: string;
  accessToken: string;
}

async function parseJsonOrThrow(res: Response, path: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    throw new MetaWhatsappError(`Meta ${res.status} em ${path}: ${text.slice(0, 500)}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new MetaWhatsappError(`Resposta nao-JSON da Meta em ${path}: ${text.slice(0, 200)}`);
  }
}

async function metaPostJson(config: MetaConfig, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

async function metaGet(config: MetaConfig, path: string) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

export interface EnviarResultado {
  ok: boolean;
  waMessageId?: string;
  erro?: string;
}

export async function enviarTexto(config: MetaConfig, telefone: string, corpo: string): Promise<EnviarResultado> {
  try {
    const data = await metaPostJson(config, `/${config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: telefone,
      type: "text",
      text: { body: corpo },
    });
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar" };
  }
}

export async function enviarMidia(
  config: MetaConfig,
  telefone: string,
  midia: { tipo: "image" | "audio" | "document"; dados: Buffer; mime: string; legenda?: string; nomeArquivo?: string },
): Promise<EnviarResultado> {
  try {
    // Upload previo do binario (endpoint /media), depois referencia por id na mensagem.
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("file", new Blob([new Uint8Array(midia.dados)], { type: midia.mime }), midia.nomeArquivo ?? "arquivo");
    const upload = await fetch(`${GRAPH_BASE}/${config.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const uploadData = await parseJsonOrThrow(upload, "/media");
    const mediaId = uploadData?.id;
    if (!mediaId) return { ok: false, erro: "Upload de midia nao retornou id" };

    const data = await metaPostJson(config, `/${config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: telefone,
      type: midia.tipo,
      [midia.tipo]: { id: mediaId, ...(midia.legenda ? { caption: midia.legenda } : {}) },
    });
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar midia" };
  }
}

/** Dois passos: metadata (URL efemera) -> bytes com header de auth. URLs da Meta expiram ~5min. */
export async function baixarMidia(config: MetaConfig, mediaId: string): Promise<{ dados: Buffer; mime: string } | null> {
  const meta = await metaGet(config, `/${mediaId}`);
  const url = meta?.url;
  const mime = meta?.mime_type;
  if (!url || !mime) return null;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { dados: buffer, mime };
}

export async function testarConexao(config: MetaConfig): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await metaGet(config, `/${config.phoneNumberId}?fields=verified_name`);
    return { ok: true, message: data?.verified_name ? `Conectado: ${data.verified_name}` : "Conexao OK" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Falha na conexao" };
  }
}
