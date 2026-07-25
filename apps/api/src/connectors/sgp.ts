import type {
  ErpConnector,
  ErpCredentials,
  ListOccurrenceParams,
  ListOsParams,
  RawOccurrence,
  RawOs,
  RawOsType,
  RawTecnico,
} from "@isphub/shared";

/**
 * Adapter para o ERP SGP. Implementacao fresca (nao copiada de nenhum outro
 * sistema) escrita a partir da documentacao publica de endpoints do SGP.
 * Cada provedor tem suas proprias credenciais (url/app/token), entao o
 * conector e instanciado por provedor — nunca ha estado global compartilhado.
 *
 * Auth SGP: `app` + `token` sao reenviados em toda chamada (sem sessao):
 *  - POST form-urlencoded: app+token no corpo.
 *  - POST JSON: app+token no corpo (obrigatorio quando ha parametros em array,
 *    pois form-urlencoded gera CSV e o SGP rejeita silenciosamente).
 *  - GET: app na query; token no header (Authorization: Token <t> e
 *    X-SGP-Token), com fallback para token na query se vier 401/403.
 */

const TIMEOUT_MS = 15_000;

class SgpError extends Error {}

function baseUrl(creds: ErpCredentials): string {
  return creds.url.replace(/\/+$/, "");
}

async function parseJsonOrThrow(res: Response, path: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    throw new SgpError(`SGP ${res.status} em ${path}: ${text.slice(0, 500)}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new SgpError(`Resposta nao-JSON do SGP em ${path}: ${text.slice(0, 200)}`);
  }
}

async function sgpPostForm(creds: ErpCredentials, path: string, params: Record<string, unknown> = {}) {
  const body = new URLSearchParams({ app: creds.app, token: creds.token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

async function sgpPostJson(creds: ErpCredentials, path: string, params: Record<string, unknown> = {}) {
  const body = { app: creds.app, token: creds.token, ...params };
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

async function sgpGet(creds: ErpCredentials, path: string, params: Record<string, unknown> = {}) {
  const qs = new URLSearchParams({ app: creds.app });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const res = await fetch(`${baseUrl(creds)}${path}?${qs.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Token ${creds.token}`,
      "X-SGP-Token": creds.token,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    // fallback: alguns endpoints antigos do SGP so aceitam token na query
    const qs2 = new URLSearchParams({ app: creds.app, token: creds.token });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs2.set(k, String(v));
    }
    const res2 = await fetch(`${baseUrl(creds)}${path}?${qs2.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return parseJsonOrThrow(res2, path);
  }
  return parseJsonOrThrow(res, path);
}

/** Extrai "lat,lng" de campos de endereco do SGP (ex.: "endereco_ll"). */
function parseLatLng(value: unknown): { lat: number | null; lng: number | null } {
  if (typeof value !== "string" || !value.includes(",")) return { lat: null, lng: null };
  const [latStr, lngStr] = value.split(",").map((s) => s.trim());
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function pick(obj: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
}

/**
 * Normaliza uma OS do SGP para o formato neutro do conector.
 * Defensivo quanto a nomes de campo: o SGP tem variantes entre a familia
 * "URA" e a familia "central/chamado" (ex.: os_id vs id, os_conteudo vs
 * conteudo), entao aceitamos os aliases mais comuns documentados.
 */
function normalizeOs(raw: Record<string, any>): RawOs {
  const llCampo = pick(raw, "endereco_ll", "contrato_endereco_ll");
  const { lat, lng } = parseLatLng(llCampo);

  return {
    sgpOsId: String(pick(raw, "os_id", "id")),
    tipoCodigo: pick(raw, "motivo_id", "motivo", "os_tipo_id"),
    tipoDescricao: pick(raw, "motivo_descricao", "tipo", "os_tipo"),
    statusCode: Number(pick(raw, "os_status", "status") ?? 0),
    prioridade: raw.os_prioridade ? Number(raw.os_prioridade) : null,
    clienteNome: pick(raw, "cliente_nome", "cliente", "razaosocial"),
    clienteDocumento: pick(raw, "cliente_cpfcnpj", "cpfcnpj"),
    contratoId: pick(raw, "contrato_id", "contrato"),
    protocolo: pick(raw, "os_protocolo", "protocolo"),
    conteudo: pick(raw, "os_conteudo", "conteudo"),
    observacao: pick(raw, "os_observacao", "observacao"),
    endereco: {
      logradouro: pick(raw, "endereco_logradouro"),
      numero: pick(raw, "endereco_numero"),
      bairro: pick(raw, "endereco_bairro"),
      cidade: pick(raw, "endereco_cidade"),
      lat,
      lng,
    },
    dataAgendamento: pick(raw, "os_data_agendamento", "data_agendamento"),
    tecnicoSgpId: pick(raw, "os_tecnico_responsavel_id", "tecnico_id"),
    tecnicoNome: pick(raw, "os_tecnico_responsavel", "tecnico"),
  };
}

function normalizeOccurrence(raw: Record<string, any>): RawOccurrence {
  return {
    sgpNumero: String(pick(raw, "numero", "os_id", "id")),
    tipo: pick(raw, "tipo"),
    status: pick(raw, "status"),
    conteudo: pick(raw, "conteudo"),
    responsavel: pick(raw, "responsavel"),
    contratoId: pick(raw, "contrato"),
    dataCadastro: pick(raw, "data_cadastro"),
    dataAgendamento: pick(raw, "data_agendamento"),
  };
}

function asArray(payload: any, ...possibleKeys: string[]): any[] {
  if (Array.isArray(payload)) return payload;
  for (const k of possibleKeys) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  return [];
}

export function createSgpConnector(creds: ErpCredentials): ErpConnector {
  return {
    async testConnection() {
      try {
        // Chamada leve e sem parametros obrigatorios: catalogo de tipos de OS.
        await sgpGet(creds, "/api/os/ocorrencia/tipo/list/");
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },

    async listOsTypes(): Promise<RawOsType[]> {
      const data = await sgpGet(creds, "/api/os/ocorrencia/tipo/list/");
      return asArray(data, "tipos", "resultados").map((item) => ({
        sgpCodigo: String(pick(item, "codigo", "id")),
        descricao: String(pick(item, "descricao", "nome") ?? ""),
      }));
    },

    async listTechnicians(): Promise<RawTecnico[]> {
      const data = await sgpPostForm(creds, "/api/ura/tecnicos/");
      return asArray(data, "tecnicos", "resultados").map((item) => ({
        sgpTecnicoId: String(pick(item, "id", "tecnico_id")),
        nome: String(pick(item, "nome", "nome_tecnico") ?? ""),
      }));
    },

    async listServiceOrders(params: ListOsParams = {}): Promise<RawOs[]> {
      const data = await sgpPostJson(creds, "/api/ura/ordemservico/list/", {
        status: params.status,
        motivo: params.motivo,
        contrato: params.contrato,
        offset: params.offset,
        limit: params.limit,
      });
      return asArray(data, "ordens_servicos", "resultados").map(normalizeOs);
    },

    async listOccurrences(params: ListOccurrenceParams = {}): Promise<RawOccurrence[]> {
      const data = await sgpPostJson(creds, "/api/ura/ocorrencia/list/", {
        tipo: params.tipo,
        status: params.status,
        offset: params.offset,
        limit: params.limit,
      });
      return asArray(data, "ocorrencias", "resultados").map(normalizeOccurrence);
    },

    async setOnTheWay(sgpOsId: string): Promise<void> {
      await sgpPostForm(creds, `/api/os/acaminho/id/${encodeURIComponent(sgpOsId)}/`);
    },

    async updateOsStatus(sgpOsId: string, statusCode: number): Promise<void> {
      await sgpPostForm(creds, `/api/os/update/id/${encodeURIComponent(sgpOsId)}/`, {
        os_status: statusCode,
      });
    },

    async addOsNote(sgpOsId: string, texto: string): Promise<void> {
      await sgpPostForm(creds, `/api/os/anotacoes/add/id/${encodeURIComponent(sgpOsId)}/`, {
        anotacao: texto,
      });
    },
  };
}
