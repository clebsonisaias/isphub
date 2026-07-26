import type {
  ErpConnector,
  ErpCredentials,
  ListOccurrenceParams,
  ListOsParams,
  RawOccurrence,
  RawOs,
  RawOsType,
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

/**
 * multipart/form-data (Content-Type: multipart/form-data, boundary automatico
 * via FormData nativo). Alguns endpoints do SGP (ex.: verificaacesso, ver
 * documentacao oficial) sao documentados com `curl --form`, que e multipart
 * por padrao — diferente do form-urlencoded usado pelo restante da API.
 */
async function sgpPostMultipart(
  creds: ErpCredentials,
  path: string,
  params: Record<string, unknown> = {},
  timeoutMs = TIMEOUT_MS,
) {
  const body = new FormData();
  body.set("app", creds.app);
  body.set("token", creds.token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(timeoutMs),
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
 * Como pick(), mas sempre retorna string (ou null). O SGP nao e consistente
 * quanto ao tipo de campos "de identificador" — contrato_id, motivo,
 * os_tecnico_responsavel_id etc podem vir como numero JSON em vez de string
 * dependendo do endpoint/instancia. Toda coluna do Prisma que armazena um
 * desses campos e String?, entao qualquer uso desses campos como valor a
 * persistir (nao como codigo a comparar em memoria) deve passar por aqui —
 * sem isso, o Prisma rejeita o upsert em runtime (contratoId numerico ja
 * quebrou o sync em producao) ou, pior, um Map.get() com chave de tipo
 * errado falha silenciosamente (tipoCodigo/tecnicoSgpId comparados contra
 * mapas sempre populados com chaves string).
 */
function pickString(obj: Record<string, any>, ...keys: string[]): string | null {
  const value = pick(obj, ...keys);
  return value === null || value === undefined ? null : String(value);
}

/**
 * Combina um par data/hora do SGP (ex.: data_cadastro="2026-07-24" +
 * hora_cadastro="10:57:51") num datetime unico. O SGP separa esses campos
 * nas listagens de OS; sem a hora, "data de abertura" sempre cairia em
 * meia-noite, perdendo o horario real do evento. Se so a data vier
 * preenchida, retorna so a data (parseable por new Date() mesmo assim).
 */
function combineDateHora(obj: Record<string, any>, dataKey: string, horaKey: string): string | null {
  const data = pickString(obj, dataKey);
  if (!data) return null;
  const hora = pickString(obj, horaKey);
  return hora ? `${data}T${hora}` : data;
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
    // "motivo" e a categoria fina (ex.: "🚨 Retirada 🚨") e e o que o SGP
    // real manda como texto, sem codigo — por isso vem antes de "tipo" (a
    // classificacao grosseira "Interna"/"Externa"). O casamento com o
    // catalogo de TipoOs (syncService.ts) aceita tanto codigo quanto texto.
    tipoCodigo: pickString(raw, "motivo_id", "motivo", "os_tipo_id"),
    tipoDescricao: pickString(raw, "motivo", "motivo_descricao", "tipo", "os_tipo"),
    statusCode: Number(pick(raw, "os_status", "status") ?? 0),
    prioridade: raw.os_prioridade ? Number(raw.os_prioridade) : null,
    clienteNome: pickString(raw, "cliente_nome", "cliente", "razaosocial"),
    clienteDocumento: pickString(raw, "cliente_cpfcnpj", "cpfcnpj"),
    contratoId: pickString(raw, "contrato_id", "contrato"),
    contratoStatus: pickString(raw, "contrato_status"),
    protocolo: pickString(raw, "os_protocolo", "protocolo"),
    conteudo: pickString(raw, "os_conteudo", "conteudo"),
    observacao: pickString(raw, "os_observacao", "observacao"),
    endereco: {
      logradouro: pickString(raw, "endereco_logradouro"),
      numero: pickString(raw, "endereco_numero"),
      bairro: pickString(raw, "endereco_bairro"),
      cidade: pickString(raw, "endereco_cidade"),
      lat,
      lng,
    },
    // O SGP nao manda endereco de rua nas listagens — "pop" (localidade/base,
    // ex.: "Macaíba") e o dado de localizacao mais fino disponivel.
    pop: pickString(raw, "pop"),
    usuario: pickString(raw, "usuario"),
    dataCadastro: combineDateHora(raw, "data_cadastro", "hora_cadastro"),
    dataAgendamento: combineDateHora(raw, "data_agendamento", "hora_agendamento") ?? pickString(raw, "os_data_agendamento"),
    // Tecnico designado no SGP (pessoal do provedor) — so informativo; o
    // despacho de verdade e feito na ISPhub, com tecnicos proprios.
    tecnicoSgpNome: pickString(raw, "os_tecnico_responsavel", "tecnico"),
  };
}

function normalizeOccurrence(raw: Record<string, any>): RawOccurrence {
  return {
    sgpNumero: String(pick(raw, "numero", "os_id", "id")),
    tipo: pickString(raw, "tipo"),
    status: pickString(raw, "status"),
    conteudo: pickString(raw, "conteudo"),
    responsavel: pickString(raw, "responsavel"),
    clienteNome: pickString(raw, "cliente", "cliente_nome"),
    contratoId: pickString(raw, "contrato"),
    contratoStatus: pickString(raw, "contrato_status"),
    pop: pickString(raw, "pop"),
    metodo: pickString(raw, "metodo"),
    usuario: pickString(raw, "usuario"),
    dataCadastro: combineDateHora(raw, "data_cadastro", "hora_cadastro"),
    dataAgendamento: combineDateHora(raw, "data_agendamento", "hora_agendamento"),
    dataFinalizacao: combineDateHora(raw, "data_finalizacao", "hora_finalizacao"),
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

    async listServiceOrders(params: ListOsParams = {}): Promise<RawOs[]> {
      const data = await sgpPostJson(creds, "/api/ura/ordemservico/list/", {
        status: params.status,
        motivo: params.motivo,
        contrato: params.contrato,
        offset: params.offset,
        limit: params.limit,
      });
      const raw = asArray(data, "ordens_servicos", "resultados");
      if (process.env.SGP_DEBUG_RAW) console.log("[sgp-debug] os[0] raw:", JSON.stringify(raw[0]));
      return raw.map(normalizeOs);
    },

    async listOccurrences(params: ListOccurrenceParams = {}): Promise<RawOccurrence[]> {
      const data = await sgpPostJson(creds, "/api/ura/ocorrencia/list/", {
        tipo: params.tipo,
        status: params.status,
        offset: params.offset,
        limit: params.limit,
      });
      const raw = asArray(data, "ocorrencias", "resultados");
      if (process.env.SGP_DEBUG_RAW) console.log("[sgp-debug] ocorrencia[0] raw:", JSON.stringify(raw[0]));
      return raw.map(normalizeOccurrence);
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

    async checkConnectionStatus(contratoId: string) {
      try {
        // Resposta real do SGP: { status, razaoSocial, staus, cpfCnpj, msg, contratoId }.
        // "msg" (ex.: "Serviço Offline"/"Serviço Online") e o sinal mais confiavel e
        // legivel — os campos status/staus nao tem semantica documentada aqui, entao
        // nao arriscamos derivar o online/offline deles.
        // Documentado com `curl --form` (multipart), diferente do form-urlencoded
        // usado no resto da API — e uma consulta ao vivo (PPPoE/RADIUS), por isso
        // timeout maior que o padrao de 15s.
        const data = await sgpPostMultipart(creds, "/api/ura/verificaacesso/", { contrato: contratoId }, 30_000);
        const msg = pickString(data, "msg");
        let online: boolean | null = null;
        if (msg) {
          if (/offline/i.test(msg)) online = false;
          else if (/online/i.test(msg)) online = true;
        }
        return { online, mensagem: msg };
      } catch (err) {
        return { online: null, mensagem: err instanceof Error ? err.message : String(err) };
      }
    },

    async getDetalhesTecnicos(contratoId: string) {
      const vazio = { endereco: null, online: null, sinalRxDbm: null, sinalTxDbm: null, oltNome: null };
      try {
        // /api/ura/clientes/ ("Cliente - Listar" na doc oficial) e o unico
        // endpoint do SGP que devolve, no mesmo payload: endereco de rua
        // completo (o resto da API so tem "pop"), sinal optico da ONU
        // (servico.onu.rx/tx, em dBm) e status de conexao
        // (servico.onu.conexao.status: "online"/"offline"). Preferimos o
        // endereco do SERVICO (mais especifico) ao do cliente (fallback).
        const data = await sgpPostForm(creds, "/api/ura/clientes/", { contrato: contratoId, limit: 1 });
        const cliente = Array.isArray(data?.clientes) ? data.clientes[0] : undefined;
        if (!cliente) return { ...vazio, mensagem: "Cliente nao encontrado para este contrato" };

        const servico = cliente.contratos?.[0]?.servicos?.[0];
        const enderecoRaw = servico?.endereco ?? cliente.endereco;
        const onu = servico?.onu;

        const endereco = enderecoRaw
          ? {
              logradouro: pickString(enderecoRaw, "logradouro"),
              numero: pickString(enderecoRaw, "numero"),
              bairro: pickString(enderecoRaw, "bairro"),
              cidade: pickString(enderecoRaw, "cidade"),
              lat: enderecoRaw.latitude != null ? Number(enderecoRaw.latitude) || null : null,
              lng: enderecoRaw.longitude != null ? Number(enderecoRaw.longitude) || null : null,
            }
          : null;

        let online: boolean | null = null;
        const conexaoStatusStr: string | null = onu?.conexao?.status ? String(onu.conexao.status) : null;
        if (conexaoStatusStr) {
          if (/offline/i.test(conexaoStatusStr)) online = false;
          else if (/online/i.test(conexaoStatusStr)) online = true;
        }

        const sinalRxDbm = onu?.rx != null && onu.rx !== "" ? Number(onu.rx) : null;
        const sinalTxDbm = onu?.tx != null && onu.tx !== "" ? Number(onu.tx) : null;

        return {
          endereco,
          online,
          sinalRxDbm: Number.isFinite(sinalRxDbm) ? sinalRxDbm : null,
          sinalTxDbm: Number.isFinite(sinalTxDbm) ? sinalTxDbm : null,
          oltNome: pickString(onu ?? {}, "olt_nome"),
          mensagem: null,
        };
      } catch (err) {
        return { ...vazio, mensagem: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
