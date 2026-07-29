/**
 * Adapter para uma instancia self-hosted da Evolution API (bridge Baileys pro
 * WhatsApp Web). Mesmas convencoes do connector do SGP: TIMEOUT_MS +
 * AbortSignal.timeout, erro tipado com corpo truncado, nunca logar a apiKey.
 *
 * Formato de payload/resposta segue a API publica da Evolution
 * (github.com/EvolutionAPI/evolution-api) — confirmar contra a instancia real
 * antes de confiar em producao (ver plano: "precisa ser confirmado contra a
 * instancia real").
 */

const TIMEOUT_MS = 15_000;

export class EvolutionApiError extends Error {}

interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

function baseUrl(config: EvolutionConfig): string {
  return config.baseUrl.replace(/\/+$/, "");
}

async function parseJsonOrThrow(res: Response, path: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    throw new EvolutionApiError(`Evolution ${res.status} em ${path}: ${text.slice(0, 500)}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new EvolutionApiError(`Resposta nao-JSON da Evolution em ${path}: ${text.slice(0, 200)}`);
  }
}

async function evolutionPost(config: EvolutionConfig, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl(config)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

async function evolutionGet(config: EvolutionConfig, path: string) {
  const res = await fetch(`${baseUrl(config)}${path}`, {
    headers: { apikey: config.apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

export interface EnviarResultado {
  ok: boolean;
  waMessageId?: string;
  erro?: string;
}

export async function enviarTexto(config: EvolutionConfig, telefone: string, corpo: string): Promise<EnviarResultado> {
  try {
    const data = await evolutionPost(config, `/message/sendText/${config.instanceName}`, {
      number: telefone,
      text: corpo,
    });
    return { ok: true, waMessageId: data?.key?.id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar" };
  }
}

export async function enviarMidia(
  config: EvolutionConfig,
  telefone: string,
  midia: { tipo: "image" | "audio" | "document"; dados: Buffer; mime: string; legenda?: string; nomeArquivo?: string },
): Promise<EnviarResultado> {
  try {
    const data = await evolutionPost(config, `/message/sendMedia/${config.instanceName}`, {
      number: telefone,
      mediatype: midia.tipo,
      mimetype: midia.mime,
      media: midia.dados.toString("base64"),
      fileName: midia.nomeArquivo,
      caption: midia.legenda,
    });
    return { ok: true, waMessageId: data?.key?.id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar midia" };
  }
}

/** Evolution normalmente entrega a midia ja em base64 no proprio payload do webhook — ver ingestao. */
export async function baixarMidia(): Promise<{ dados: Buffer; mime: string } | null> {
  return null;
}

export async function testarConexao(config: EvolutionConfig): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await evolutionGet(config, `/instance/connectionState/${config.instanceName}`);
    const estado = data?.instance?.state ?? data?.state;
    return { ok: estado === "open", message: estado ? `Estado: ${estado}` : "Sem estado retornado" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Falha na conexao" };
  }
}
