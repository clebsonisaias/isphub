import { SgpOsStatus } from "@isphub/shared";
import { env } from "../config/env.js";
import type {
  ErpConnector,
  ErpCredentials,
  ListOsParams,
  Olt,
  OnuAutorizada,
  OnuNaoAutorizada,
  OnuTemplate,
  ProvisionarOnuInput,
  ProvisionarOnuResultado,
  RawOs,
  RawOsType,
  SgpImagem,
  SgpImagemArquivo,
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

/**
 * O SGP recusou (4xx)? Recusa significa que NADA foi escrito, entao e seguro
 * repetir a chamada de outro jeito. Distinguir de 5xx/timeout importa: ali a
 * escrita pode ter acontecido, e repetir duplicaria.
 */
function ehRecusa4xx(err: unknown): boolean {
  if (!(err instanceof SgpError)) return false;
  const status = Number(/SGP (\d{3}) em/.exec(err.message)?.[1]);
  return status >= 400 && status < 500;
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

/**
 * Alguns endpoints de escrita do SGP recusam a operacao por regra de negocio
 * (ex.: encerrar OS de contrato cancelado) mas ainda respondem HTTP 200 —
 * parseJsonOrThrow so valida o status HTTP, entao sem isso a recusa vira
 * "sucesso" pro resto do sistema (writebackService confirma a mudanca local
 * achando que o SGP aceitou). Cobre as convencoes mais comuns de erro em
 * corpo 200 desse tipo de API (erro/error, sucesso:false/success:false).
 */
function assertSgpEscritaOk(data: any, path: string): void {
  if (data == null || typeof data !== "object") return;
  const erro = pickString(data, "erro", "error");
  if (erro) throw new SgpError(`SGP recusou a escrita em ${path}: ${erro}`);
  if (data.sucesso === false || data.success === false) {
    const msg = pickString(data, "msg", "mensagem") ?? "recusado pelo SGP";
    throw new SgpError(`SGP recusou a escrita em ${path}: ${msg}`);
  }
}

/**
 * Credencial NO HEADER — o mesmo par que as leituras (sgpGet) sempre mandaram.
 *
 * As escritas iam so com app+token no CORPO, sem header de autenticacao
 * nenhum. Como as leituras funcionam com header e o mesmo token, um SGP que
 * autentica por header via a escrita chegar sem credencial reconhecivel e
 * respondia 403 de corpo VAZIO — recusa do framework, antes de olhar
 * permissao. Era o caso do /api/os/acaminho/.
 *
 * Mantemos app+token no corpo tambem: instancias que autenticam pelo corpo
 * continuam funcionando, e header que o SGP nao usa ele simplesmente ignora.
 */
function authHeaders(creds: ErpCredentials): Record<string, string> {
  return { Authorization: `Token ${creds.token}`, "X-SGP-Token": creds.token };
}

async function sgpPostForm(creds: ErpCredentials, path: string, params: Record<string, unknown> = {}) {
  const body = new URLSearchParams({ app: creds.app, token: creds.token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(creds) },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

async function sgpPostJson(creds: ErpCredentials, path: string, params: Record<string, unknown> = {}) {
  const body = { app: creds.app, token: creds.token, ...params };
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(creds) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

/**
 * multipart/form-data (Content-Type: multipart/form-data, boundary automatico
 * via FormData nativo). Alguns endpoints do SGP (ex.: verificaacesso, anexar
 * imagem — ver documentacao oficial) sao documentados com `curl --form`, que
 * e multipart por padrao — diferente do form-urlencoded usado pelo resto da
 * API. `method` e parametrizavel porque "Anexar Imagem" e um PUT, nao POST.
 */
async function sgpMultipart(
  creds: ErpCredentials,
  method: "POST" | "PUT",
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
    method,
    // Sem Content-Type: o FormData define o boundary sozinho. So a credencial.
    headers: authHeaders(creds),
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return parseJsonOrThrow(res, path);
}

/**
 * Detecta o tipo real de uma imagem pelos "magic bytes" do inicio do arquivo.
 * Necessario porque o SGP salva todo anexo com extensao .png e responde
 * `Content-Type: image/png` independente do formato de verdade — confirmado
 * ao vivo em producao: um JPEG enviado volta nomeado "...png" e declarado
 * como png, mas com bytes JPEG (FF D8 FF). Navegador aguenta (faz sniffing
 * em <img>), mas o arquivo baixado fica com tipo mentindo sobre o conteudo.
 * Retorna null quando nao reconhece a assinatura (aí vale o que o SGP disse).
 */
function detectarMimeTypeImagem(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const [b0, b1, b2, b3] = bytes;
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "image/jpeg";
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return "image/png";
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return "image/gif";
  // WebP: "RIFF" .... "WEBP"
  if (
    b0 === 0x52 &&
    b1 === 0x49 &&
    b2 === 0x46 &&
    b3 === 0x46 &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Como sgpGet, mas devolve os bytes crus (pra proxy de arquivo/imagem) em vez de tentar parsear JSON. */
async function sgpGetBinary(
  creds: ErpCredentials,
  path: string,
  params: Record<string, unknown> = {},
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  const qs = new URLSearchParams({ app: creds.app, token: creds.token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const res = await fetch(`${baseUrl(creds)}${path}?${qs.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const contentTypeSgp = res.headers.get("content-type") ?? "application/octet-stream";
  // Se o SGP responder JSON (ex.: erro disfarçado de 200, ou anexo inexistente),
  // nao e um arquivo de verdade — trata como "nao encontrado".
  if (contentTypeSgp.includes("application/json")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  // SO os bytes mandam. O cabecalho do SGP NUNCA vira Content-Type nosso: o SGP
  // e de terceiro (o provedor opera o dele), e um SGP malicioso ou comprometido
  // que respondesse `text/html` fazia a nossa API servir HTML na propria origem
  // — que o web transforma em blob: URL da origem do SPA, executando script com
  // acesso ao token em localStorage. Bytes irreconheciveis viram octet-stream.
  return { contentType: detectarMimeTypeImagem(bytes) ?? "application/octet-stream", bytes };
}

/**
 * GET autenticado do jeito DOCUMENTADO: `token` + `app` como parametros.
 *
 * Antes so o `app` ia na query e o token so no header (`Authorization: Token`),
 * um esquema que a doc do SGP nao cita — quem seguia a doc respondia 401/403 e
 * so entao caia no fallback com token na query. Funcionava, mas gastando DUAS
 * idas ao SGP em toda leitura: com o limite de 3 chamadas FTTX simultaneas por
 * provedor, isso e metade da vazao jogada fora.
 *
 * Os headers continuam indo junto: instancias que autenticam por header
 * seguem funcionando, e header que o SGP nao usa ele ignora.
 */
async function sgpGet(creds: ErpCredentials, path: string, params: Record<string, unknown> = {}) {
  const qs = new URLSearchParams({ app: creds.app, token: creds.token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const res = await fetch(`${baseUrl(creds)}${path}?${qs.toString()}`, {
    headers: { Accept: "application/json", ...authHeaders(creds) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseJsonOrThrow(res, path);
}

const PAGINACAO_MAX_PAGINAS = 50;

/**
 * Segue paginacao estilo Django REST Framework (`{count,next,previous,results}`)
 * se o SGP usar — a doc oficial mostra `/olt/list/` como array puro, mas um
 * provedor com muitas OLTs pode cair no paginador padrao do framework mesmo
 * sem isso estar documentado (foi visto na pratica: NetGo com so 1 OLT
 * aparecendo quando tinha mais). Sem isso, tudo alem da 1a pagina
 * simplesmente sumia da lista, sem erro nenhum. `next` vem como URL absoluta
 * do proprio SGP — refeita com os mesmos headers de auth do path original.
 * Teto de paginas como rede de seguranca contra um `next` que nunca esvazia.
 */
async function sgpGetPaginado(creds: ErpCredentials, path: string, ...possibleKeys: string[]): Promise<any[]> {
  const primeira = await sgpGet(creds, path);
  const itens = asArray(primeira, ...possibleKeys, "resultados", "results");
  let proxima = typeof (primeira as { next?: unknown })?.next === "string" ? (primeira as { next: string }).next : null;

  for (let pagina = 0; proxima && pagina < PAGINACAO_MAX_PAGINAS; pagina++) {
    const res = await fetch(proxima, {
      headers: { Accept: "application/json", Authorization: `Token ${creds.token}`, "X-SGP-Token": creds.token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corpo = await parseJsonOrThrow(res, path);
    itens.push(...asArray(corpo, ...possibleKeys, "resultados", "results"));
    proxima = typeof (corpo as { next?: unknown })?.next === "string" ? (corpo as { next: string }).next : null;
  }
  return itens;
}

/**
 * Consulta ao vivo (PPPoE/RADIUS) se o servico do contrato esta online —
 * usada tanto por checkConnectionStatus (sozinha) quanto por
 * getDetalhesTecnicos (em paralelo com o endereco/sinal, ver abaixo).
 * Resposta real do SGP: { status, razaoSocial, staus, cpfCnpj, msg,
 * contratoId }. "msg" (ex.: "Serviço Offline"/"Serviço Online") e o sinal
 * mais confiavel e legivel — os campos status/staus nao tem semantica
 * documentada aqui, entao nao arriscamos derivar o online/offline deles.
 * Documentado com `curl --form` (multipart), diferente do form-urlencoded
 * usado no resto da API — timeout maior que o padrao de 15s.
 */
async function verificarAcesso(
  creds: ErpCredentials,
  contratoId: string,
): Promise<{ online: boolean | null; mensagem: string | null }> {
  try {
    const data = await sgpMultipart(creds, "POST", "/api/ura/verificaacesso/", { contrato: contratoId }, 30_000);
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
}

/**
 * Endereco "de referencia" de um cliente do /api/ura/clientes/: prefere o do
 * SERVICO (mais especifico) ao do cliente. Compartilhado por
 * getDetalhesTecnicos (dialog, ao vivo) e getContratoGeo (backfill do mapa).
 */
function enderecoDoCliente(cliente: any): any {
  const servico = cliente?.contratos?.[0]?.servicos?.[0];
  return servico?.endereco ?? cliente?.endereco ?? null;
}

/**
 * lat/lng de um endereco do cadastro do cliente (campos latitude/longitude,
 * que o SGP manda como string ou number). `Number(x) || null` trata 0, ""
 * e NaN como "sem coordenada" — 0,0 e a "null island" no golfo da Guine,
 * nunca um endereco real de provedor brasileiro.
 */
function parseGeoCliente(enderecoRaw: any): { lat: number | null; lng: number | null } {
  return {
    lat: enderecoRaw?.latitude != null ? Number(enderecoRaw.latitude) || null : null,
    lng: enderecoRaw?.longitude != null ? Number(enderecoRaw.longitude) || null : null,
  };
}

/**
 * Telefone/contato do cliente no payload de /api/ura/clientes/. O SGP nao e
 * consistente no nome nem na forma desse campo entre instancias — tenta os
 * aliases diretos e tambem as formas em lista (telefones[], telefones_cargos[]
 * — este ultimo confirmado na doc de "Cliente - Consultar"). Se nada bater,
 * retorna null (o card so nao mostra o contato).
 */
function extrairTelefoneCliente(cliente: any): string | null {
  const direto = pickString(cliente, "telefone", "celular", "fone", "whatsapp", "contato", "telefone1");
  if (direto) return direto;
  for (const lista of [cliente?.telefones_cargos, cliente?.telefones, cliente?.contatos]) {
    if (!Array.isArray(lista)) continue;
    for (const t of lista) {
      const v = typeof t === "string" ? t.trim() || null : pickString(t ?? {}, "contato", "telefone", "numero", "fone", "celular");
      if (v) return v;
    }
  }
  return null;
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
    // "status_id" (numerico) vem ANTES de "status" porque o SGP real manda o
    // rotulo textual em "status" ("Encerrada") e o codigo em "status_id" —
    // pegar o texto fazia Number() virar NaN e o mapeamento cair no default
    // "Aberta", marcando TODA OS como aberta pra sempre. mapSgpOsStatus
    // tambem entende o texto, entao os dois formatos funcionam.
    statusCode: pick(raw, "os_status", "status_id", "status") ?? 0,
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

/**
 * Formata uma data ISO no padrao que o SGP espera em campos de escrita:
 * "AAAA-MM-DD HH:mm:ss", sempre em horario de Brasilia — o container roda
 * em UTC (sem TZ configurada), e o SGP e um sistema brasileiro, entao usar
 * o timezone do processo (`Date#getHours` etc) mandaria a hora errada.
 */
function formatarDataSgp(iso: string): string {
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

function asArray(payload: any, ...possibleKeys: string[]): any[] {
  if (Array.isArray(payload)) return payload;
  for (const k of possibleKeys) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  return [];
}

/** Converte um valor do SGP (string|number|""|null) em number ou null. */
function numeroOuNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Copia os params de provisionamento com os SEGREDOS mascarados, pra poder
 * logar o payload (debug FTTX) sem vazar credencial. SGP_DEBUG_RAW esta ligado
 * em producao e loga corpo cru — a senha PPPoE/Wi-Fi e o token nunca podem ir
 * pro log. Exportada pra ser testada isoladamente.
 */
export function redigirSegredosFttx<T extends Record<string, unknown>>(params: T): T {
  const CHAVES_SECRETAS = ["pppoe_password", "wifi_password", "token"];
  const copia: Record<string, unknown> = { ...params };
  for (const chave of CHAVES_SECRETAS) {
    if (copia[chave] != null && copia[chave] !== "") copia[chave] = "***";
  }
  return copia as T;
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
      // O objetivo do debug e descobrir NOMES DE CAMPO do SGP, nunca os valores.
      // Antes isto despejava o registro cru inteiro — nome, CPF/CNPJ, endereco e
      // telefone do assinante — nos logs do container, a cada ciclo de sync de
      // cada provedor (padrao: 180s). Agora sai so o formato.
      if (env.SGP_DEBUG_RAW && raw[0]) {
        console.log("[sgp-debug] campos da os:", JSON.stringify(Object.keys(raw[0] as object).sort()));
      }
      return raw.map(normalizeOs);
    },

    /**
     * JSON, nao form-urlencoded — mesma licao ja aprendida no updateOsStatus
     * logo abaixo. Como form, este endpoint respondia 403 de corpo VAZIO
     * (recusa no nivel do framework, antes de olhar credencial), o que parecia
     * falta de permissao do token e mandava a investigacao pro lado errado.
     *
     * Se algum SGP mais antigo so aceitar form, cai pro form no 4xx: a recusa
     * garante que nada foi escrito, entao repetir e seguro — e a alternativa
     * seria quebrar o "a caminho" pra quem roda a versao antiga.
     */
    async setOnTheWay(sgpOsId: string): Promise<void> {
      const path = `/api/os/acaminho/id/${encodeURIComponent(sgpOsId)}/`;
      try {
        const data = await sgpPostJson(creds, path);
        assertSgpEscritaOk(data, path);
      } catch (err) {
        if (!ehRecusa4xx(err)) throw err;
        const data = await sgpPostForm(creds, path);
        assertSgpEscritaOk(data, path);
      }
    },

    async updateOsStatus(sgpOsId: string, statusCode: number, dataFinalizacao?: string): Promise<void> {
      const path = `/api/os/update/id/${encodeURIComponent(sgpOsId)}/`;
      try {
        // JSON, nao form-urlencoded: a doc oficial de "Alterar Ordem de
        // Servico" e explicita (`Content-Type: application/json`). Enviado
        // como form, o SGP responde 200 e ignora o corpo inteiro — o status
        // simplesmente nao mudava, sem erro nenhum pra denunciar.
        const data = await sgpPostJson(creds, path, {
          os_status: statusCode,
          os_data_finalizacao: dataFinalizacao ? formatarDataSgp(dataFinalizacao) : undefined,
          // Registra quando a alteracao partiu do ISPhub.
          os_data_alteracao: formatarDataSgp(new Date().toISOString()),
        });
        assertSgpEscritaOk(data, path);
      } catch (err) {
        // O SGP recusa reencerrar uma OS que ja esta encerrada do lado dele
        // (ex.: espelho local desatualizado porque o sync nao volta a puxar
        // uma OS que ja saiu da listagem de abertas, ou ela foi encerrada
        // direto no SGP fora do ISPhub). Se o alvo era Encerrada e o SGP
        // confirma que ja e esse o estado real, trata como sucesso
        // idempotente em vez de erro — o writeback entao corrige o espelho
        // local pro estado que o SGP diz ser verdade, em vez de deixar a OS
        // presa pra sempre mostrando um erro toda vez que alguem tenta.
        const msg = err instanceof Error ? err.message : String(err);
        const jaEncerrada = statusCode === SgpOsStatus.ENCERRADA && /j[áa]\s*(foi\s+)?encerrada/i.test(msg);
        if (!jaEncerrada) throw err;
      }
    },

    async addOsNote(sgpOsId: string, texto: string): Promise<void> {
      const path = `/api/os/anotacoes/add/id/${encodeURIComponent(sgpOsId)}/`;
      const data = await sgpPostForm(creds, path, { anotacao: texto });
      assertSgpEscritaOk(data, path);
    },

    async checkConnectionStatus(contratoId: string) {
      return verificarAcesso(creds, contratoId);
    },

    async getDetalhesTecnicos(contratoId: string) {
      const vazio = { endereco: null, online: null, sinalRxDbm: null, sinalTxDbm: null, oltNome: null };
      try {
        // /api/ura/clientes/ ("Cliente - Listar" na doc oficial) devolve, no
        // mesmo payload: endereco de rua completo (o resto da API so tem
        // "pop") e sinal optico da ONU (servico.onu.rx/tx, em dBm). Nao tem
        // status de conexao (confirmado com payload real: o objeto "onu" nao
        // tem nenhum campo online/offline) — por isso /api/ura/verificaacesso/
        // (mesmo endpoint de checkConnectionStatus) e chamado em paralelo,
        // pra devolver endereco+sinal+online num unico resultado sem dobrar
        // o numero de chamadas que o front precisa fazer por card da fila.
        // Preferimos o endereco do SERVICO (mais especifico) ao do cliente.
        const [dataCliente, acesso] = await Promise.all([
          sgpPostForm(creds, "/api/ura/clientes/", { contrato: contratoId, limit: 1 }),
          verificarAcesso(creds, contratoId),
        ]);
        const cliente = Array.isArray(dataCliente?.clientes) ? dataCliente.clientes[0] : undefined;
        if (!cliente) return { ...vazio, online: acesso.online, mensagem: acesso.mensagem ?? "Cliente nao encontrado para este contrato" };

        const servico = cliente.contratos?.[0]?.servicos?.[0];
        const enderecoRaw = enderecoDoCliente(cliente);
        const onu = servico?.onu;

        const endereco = enderecoRaw
          ? {
              logradouro: pickString(enderecoRaw, "logradouro"),
              numero: pickString(enderecoRaw, "numero"),
              bairro: pickString(enderecoRaw, "bairro"),
              cidade: pickString(enderecoRaw, "cidade"),
              ...parseGeoCliente(enderecoRaw),
            }
          : null;

        const sinalRxDbm = onu?.rx != null && onu.rx !== "" ? Number(onu.rx) : null;
        const sinalTxDbm = onu?.tx != null && onu.tx !== "" ? Number(onu.tx) : null;

        return {
          endereco,
          online: acesso.online,
          sinalRxDbm: Number.isFinite(sinalRxDbm) ? sinalRxDbm : null,
          sinalTxDbm: Number.isFinite(sinalTxDbm) ? sinalTxDbm : null,
          oltNome: pickString(onu ?? {}, "olt_nome"),
          mensagem: acesso.mensagem,
        };
      } catch (err) {
        return { ...vazio, mensagem: err instanceof Error ? err.message : String(err) };
      }
    },

    async getContratoCadastro(contratoId: string) {
      // Endereco de rua + geo + telefone do cadastro do cliente — a listagem
      // de OS nao traz nenhum desses. Versao enxuta de getDetalhesTecnicos
      // (sem verificaacesso/sinal), pro backfill em massa nao dobrar as
      // chamadas ao SGP por contrato.
      // Distingue "nao deu pra consultar" (null -> tenta de novo depois) de
      // "cliente consultado" (objeto, campos possivelmente null -> marca a
      // tentativa e nao insiste).
      try {
        const data = await sgpPostForm(creds, "/api/ura/clientes/", { contrato: contratoId, limit: 1 });
        const cliente = Array.isArray(data?.clientes) ? data.clientes[0] : undefined;
        if (!cliente) return null;
        const enderecoRaw = enderecoDoCliente(cliente);
        return {
          ...parseGeoCliente(enderecoRaw),
          logradouro: pickString(enderecoRaw ?? {}, "logradouro"),
          numero: pickString(enderecoRaw ?? {}, "numero"),
          bairro: pickString(enderecoRaw ?? {}, "bairro"),
          cidade: pickString(enderecoRaw ?? {}, "cidade"),
          telefone: extrairTelefoneCliente(cliente),
        };
      } catch {
        return null;
      }
    },

    async addOsImage(sgpOsId: string, imagemBase64: string, descricao?: string): Promise<void> {
      // Documentado com curl --form (multipart); campo e "image_b64" (o texto
      // descritivo da doc chama de "image_base64", mas o exemplo de curl usa
      // "image_b64" — seguimos o exemplo, mais confiavel que a prosa).
      const path = `/api/os/imagem/id/${encodeURIComponent(sgpOsId)}/add/`;
      const data = await sgpMultipart(creds, "PUT", path, { image_b64: imagemBase64, descricao });
      assertSgpEscritaOk(data, path);
    },

    async listOsImages(sgpOsId: string): Promise<SgpImagem[]> {
      const data = await sgpGet(creds, `/api/os/imagem/id/${encodeURIComponent(sgpOsId)}/list/`);
      return asArray(data, "imagens", "resultados").map((item) => ({
        id: String(pick(item, "id")),
        descricao: pickString(item, "descricao"),
        usuario: pickString(item, "usuario"),
        arquivo: pickString(item, "arquivo"),
      }));
    },

    async getOsImageFile(anexoId: string): Promise<SgpImagemArquivo | null> {
      // "Visualizar Anexo por ID" — unico endpoint desta familia que devolve
      // o arquivo em si (binario), nao um JSON de metadados.
      return sgpGetBinary(creds, `/api/os/imagem/${encodeURIComponent(anexoId)}`);
    },

    // ---- FTTX / provisionamento de ONU (por OLT do provedor) ----

    async listarOlts(): Promise<Olt[]> {
      const itens = await sgpGetPaginado(creds, "/api/fttx/olt/list/", "olts");
      return itens.map((item) => ({
        id: String(pick(item, "id")),
        nome: String(pick(item, "nome", "name") ?? ""),
        // `olttype` e o campo REAL da doc de "Listar OLT" (ex.: "Parks") — sem
        // ele o fabricante vinha sempre null, e a tela de provisionamento
        // mostrava a OLT sem o unico dado que diz ao tecnico com que
        // equipamento ele esta lidando.
        fabricante: pickString(item, "olttype", "fabricante", "fabricante_nome", "marca"),
      }));
    },

    async listarOnusNaoAutorizadas(oltId: string): Promise<OnuNaoAutorizada[]> {
      // Preferido: GET /olt/:id/unauth/. Algumas instancias so expoem
      // POST /onu/unauthorized/ {olt_id} — cai pra ela se a primeira falhar.
      let data: any;
      try {
        data = await sgpGet(creds, `/api/fttx/olt/${encodeURIComponent(oltId)}/unauth/`);
      } catch {
        data = await sgpPostForm(creds, "/api/fttx/onu/unauthorized/", { olt_id: oltId });
      }
      return asArray(data, "onus", "unauth", "resultados").map((item) => ({
        id: String(pick(item, "id", "onu_id") ?? ""),
        serial: String(pick(item, "phy_addr", "serial", "sn") ?? ""),
        slot: pickString(item, "slot"),
        pon: pickString(item, "pon"),
        tipo: pickString(item, "type", "onutype", "tipo"),
        vlan: numeroOuNull(pick(item, "vlan")),
        sinalRxDbm: numeroOuNull(pick(item, "info_rx", "rx")),
      }));
    },

    async listarOnusAutorizadas(
      oltId: string,
      filtro: { contrato?: string; cpfcnpj?: string } = {},
    ): Promise<OnuAutorizada[]> {
      const data = await sgpGet(creds, `/api/fttx/olt/${encodeURIComponent(oltId)}/onu/list/`, {
        contrato: filtro.contrato,
        cpfcnpj: filtro.cpfcnpj,
      });
      return asArray(data, "onus", "resultados").map((item) => ({
        id: String(pick(item, "id", "onu_id") ?? ""),
        serial: String(pick(item, "phy_addr", "serial", "sn") ?? ""),
        slot: pickString(item, "slot"),
        pon: pickString(item, "pon"),
        contrato: pickString(item, "service_contrato", "contrato"),
        clienteNome: pickString(item, "service_cliente", "cliente", "cliente_nome"),
        sinalRxDbm: numeroOuNull(pick(item, "info_rx", "rx")),
        online: null,
      }));
    },

    async listarTemplatesOnu(oltId: string): Promise<OnuTemplate[]> {
      const data = await sgpGet(creds, "/api/fttx/onutemplate/list/", { olt_id: oltId });
      // O SGP nomeia o template em `description` (ingles); mantemos os aliases.
      return asArray(data, "onutemplates", "templates", "resultados").map((item) => ({
        id: String(pick(item, "id") ?? ""),
        nome: String(pick(item, "description", "nome", "name", "descricao") ?? ""),
      }));
    },

    async provisionarOnu(oltId: string, dados: ProvisionarOnuInput): Promise<ProvisionarOnuResultado> {
      const path = `/api/fttx/olt/${encodeURIComponent(oltId)}/auth/`;
      // `id` no corpo do SGP = o serial/phy_addr da ONU (a doc chama de id).
      const params: Record<string, unknown> = {
        slot: dados.slot,
        pon: dados.pon,
        id: dados.serial,
        // onutype e opcional: quando ausente, o SGP detecta o modelo pelo SN.
        onutype: dados.onutype ?? undefined,
        mode: dados.mode,
        vlan: dados.vlan ?? undefined,
        contrato: dados.contrato ?? undefined,
        service: dados.service ?? undefined,
        pppoe_login: dados.pppoeLogin ?? undefined,
        pppoe_password: dados.pppoeSenha ?? undefined,
        onutemplate: dados.onutemplate ?? undefined,
        description: dados.descricao ?? undefined,
        ident: dados.ident ?? undefined,
      };
      // SGP_DEBUG_RAW loga corpo cru em producao — redige a senha/token antes.
      if (env.SGP_DEBUG_RAW) {
        console.log("[sgp-debug] fttx auth:", path, JSON.stringify(redigirSegredosFttx({ ...params, token: creds.token })));
      }
      const data = await sgpPostForm(creds, path, params);
      assertSgpEscritaOk(data, path);
      return {
        ok: true,
        mensagem: pickString(data ?? {}, "msg", "mensagem"),
        onuId: pickString(data ?? {}, "id", "onu_id"),
      };
    },

    async desautorizarOnu(onuId: string): Promise<{ ok: boolean; mensagem: string | null }> {
      // deauth e um GET que MUTA (design do SGP); a intencao aqui e efetivar a
      // remocao, entao nao mandamos no_commit.
      const path = `/api/fttx/onu/${encodeURIComponent(onuId)}/deauth/`;
      const data = await sgpGet(creds, path);
      assertSgpEscritaOk(data, path);
      return { ok: true, mensagem: pickString(data ?? {}, "msg", "mensagem") };
    },
  };
}
