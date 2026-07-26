import { SgpOsStatus } from "@isphub/shared";
import type {
  ErpConnector,
  ErpCredentials,
  ListOccurrenceParams,
  ListOsParams,
  RawOccurrence,
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
  // Os bytes mandam mais que o cabecalho do SGP (ver detectarMimeTypeImagem).
  return { contentType: detectarMimeTypeImagem(bytes) ?? contentTypeSgp, bytes };
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
      const path = `/api/os/acaminho/id/${encodeURIComponent(sgpOsId)}/`;
      const data = await sgpPostForm(creds, path);
      assertSgpEscritaOk(data, path);
    },

    async updateOsStatus(sgpOsId: string, statusCode: number, dataFinalizacao?: string): Promise<void> {
      const path = `/api/os/update/id/${encodeURIComponent(sgpOsId)}/`;
      try {
        const data = await sgpPostForm(creds, path, {
          os_status: statusCode,
          os_data_finalizacao: dataFinalizacao ? formatarDataSgp(dataFinalizacao) : undefined,
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
  };
}
