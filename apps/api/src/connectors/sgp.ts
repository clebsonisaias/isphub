import { SgpOsStatus } from "@isphub/shared";
import { env } from "../config/env.js";
import type {
  ErpConnector,
  ErpCredentials,
  ListagemOs,
  ListOsParams,
  Olt,
  OnuAutorizada,
  OnuNaoAutorizada,
  OnuTemplate,
  ProvisionarOnuInput,
  ProvisionarOnuResultado,
  RawOs,
  OsFichaSgp,
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
 * Auth SGP: `app` + `token` sao reenviados em toda chamada (sem sessao), no
 * formato que a doc pede — `token+app` — E tambem no header
 * (`Authorization: Token <t>` + `X-SGP-Token`), porque instancias diferentes
 * leem de lugares diferentes e header que o SGP nao usa ele ignora:
 *  - GET: token+app na query.
 *  - POST form-urlencoded: app+token no corpo.
 *  - POST JSON: app+token no corpo (obrigatorio quando ha parametros em array,
 *    pois form-urlencoded gera CSV e o SGP rejeita silenciosamente).
 *  - multipart: app+token no FormData (sem fixar Content-Type — o boundary e
 *    do proprio FormData).
 */

const TIMEOUT_MS = 15_000;

/**
 * Falha vinda do SGP. Guarda `status` e `mensagemNegocio` em CAMPOS, nao so
 * embutidos no texto: quando o SGP recusa por regra de negocio (ex.: "É
 * necessário haver ao menos 2 foto(s) para encerrar o chamado"), essa frase e
 * a unica coisa que interessa a quem esta em campo. Extrair de volta do texto
 * com regex seria fragil — a mensagem contem URL, com `:` e `//`.
 */
export class SgpError extends Error {
  status?: number;
  /** Frase que o SGP escreveu no corpo (msg/erro/detail), quando houver. */
  mensagemNegocio?: string;
}

/** Le a frase de negocio do corpo de erro do SGP, se ele mandou uma. */
function mensagemDeNegocio(corpo: string): string | undefined {
  try {
    const j = JSON.parse(corpo);
    if (!j || typeof j !== "object") return undefined;
    for (const k of ["msg", "mensagem", "erro", "error", "detail", "detalhe"]) {
      const v = (j as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    // corpo nao-JSON (HTML de erro, texto solto) — nao ha frase confiavel
  }
  return undefined;
}

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

/**
 * SO a origem (https://host), NUNCA a URL completa: os GETs levam `token` na
 * query, entao logar a URL inteira jogaria a credencial do provedor no log do
 * servidor. A origem responde "foi pro SGP de quem?" sem vazar nada.
 */
function origemSegura(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "?";
  }
}

async function parseJsonOrThrow(res: Response, path: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    // Sem o host, "SGP 403 em /api/os/acaminho/" nao diz de qual provedor veio
    // a recusa — e com varios SGPs atendidos, essa era a primeira pergunta
    // que o log nao respondia.
    const erro = new SgpError(`SGP ${res.status} em ${origemSegura(res.url)}${path}: ${text.slice(0, 500)}`);
    erro.status = res.status;
    erro.mensagemNegocio = mensagemDeNegocio(text);
    throw erro;
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
 * Tamanho de pagina ao listar OS. Explicito de proposito: sem `limit` o SGP
 * aplica o default dele (nao documentado), e o espelho passava a depender de um
 * numero que a gente nem sabia qual era.
 */
const PAGINA_OS = 200;

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

  let paginasSeguidas = 0;
  for (let pagina = 0; proxima && pagina < PAGINACAO_MAX_PAGINAS; pagina++) {
    // A credencial tem que ir na URL do `next` tambem. O SGP monta esse link a
    // partir da requisicao original, mas se por qualquer motivo ele vier sem
    // `token`/`app`, a pagina 2 volta 403 e a lista fica truncada — que e
    // exatamente o sintoma de "so aparece 1 OLT".
    const urlProxima = new URL(proxima);
    if (!urlProxima.searchParams.has("token")) urlProxima.searchParams.set("token", creds.token);
    if (!urlProxima.searchParams.has("app")) urlProxima.searchParams.set("app", creds.app);

    const res = await fetch(urlProxima.toString(), {
      headers: { Accept: "application/json", ...authHeaders(creds) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corpo = await parseJsonOrThrow(res, path);
    itens.push(...asArray(corpo, ...possibleKeys, "resultados", "results"));
    proxima = typeof (corpo as { next?: unknown })?.next === "string" ? (corpo as { next: string }).next : null;
    paginasSeguidas++;
  }

  // Evidencia pra diagnosticar lista truncada: antes, "veio 1 item" e "o SGP
  // so tem 1" eram indistinguiveis do lado de fora.
  console.log(
    `[sgp] ${path}: ${itens.length} item(ns), ${paginasSeguidas} pagina(s) extra(s)` +
      `${proxima ? " — PAROU NO TETO DE PAGINAS" : ""}`,
  );
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

/**
 * Cadastro do cliente pelo contrato, via `/api/ura/clientes/` — o caminho
 * normal, que atende contrato ativo.
 */
async function buscarClientePorContrato(creds: ErpCredentials, contratoId: string): Promise<any | null> {
  const data = await sgpPostForm(creds, "/api/ura/clientes/", { contrato: contratoId, limit: 1 });
  const [cliente] = asArray(data, "clientes", "resultados", "results");
  return cliente ?? null;
}

/**
 * Mesma consulta, mas por `/api/ura/consultacliente/` pedindo TODOS os status
 * de contrato — o unico caminho que alcanca contrato inativo/cancelado.
 *
 * Best-effort de proposito: e um complemento, nao a fonte primaria. Se o
 * endpoint nao existir nesta instancia do SGP, responder 4xx/5xx, ou devolver
 * um envelope que `asArray` nao reconhece, devolve null e quem chama segue com
 * o que ja tinha. Nunca deixa o backfill inteiro cair por causa disso.
 */
async function buscarClientePorContratoQualquerStatus(
  creds: ErpCredentials,
  contratoId: string,
): Promise<any | null> {
  try {
    const data = await sgpPostForm(creds, "/api/ura/consultacliente/", {
      contrato: contratoId,
      // 1=Ativo, 2=Inativo, 3=Cancelado, 4=Suspenso, 5=Inviabilidade Tecnica,
      // 6=Novo, 7=Ativo V. Reduzida — os sete, pra nao excluir nenhum caso.
      status: "1,2,3,4,5,6,7",
    });
    const [cliente] = asArray(data, "clientes", "resultados", "results");
    return cliente ?? null;
  } catch {
    return null;
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
/**
 * Primeiro valor ESCALAR entre as chaves dadas.
 *
 * Objeto e array voltam null de proposito: o `String(value)` anterior aceitava
 * qualquer coisa e virava "[object Object]" na tela — foi assim que "Plano
 * contratado: [object Object]" chegou ao usuario. Uma funcao chamada
 * `pickString` que devolve o texto de um objeto nao esta pegando string, esta
 * escondendo que o formato mudou. Null faz o campo sumir; "[object Object]"
 * mente com aparencia de dado.
 */
function pickString(obj: Record<string, any>, ...keys: string[]): string | null {
  const value = pick(obj, ...keys);
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Nome do plano quando o SGP manda um OBJETO em vez de texto.
 *
 * Visto em producao na NetGo: `servico_plano` chega como objeto, nao string.
 * O SGP varia de instancia pra instancia aqui, entao tenta as chaves de nome
 * mais comuns em vez de fixar uma — e devolve null se nenhuma servir, que e
 * melhor que exibir lixo.
 */
function nomeDoPlano(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor !== "object") {
    const s = String(valor).trim();
    return s === "" ? null : s;
  }
  return pickString(valor as Record<string, any>, "nome", "descricao", "plano", "titulo", "name", "display");
}

/**
 * Combina um par data/hora do SGP (ex.: data_cadastro="2026-07-24" +
 * hora_cadastro="10:57:51") num datetime unico. O SGP separa esses campos
 * nas listagens de OS; sem a hora, "data de abertura" sempre cairia em
 * meia-noite, perdendo o horario real do evento. Se so a data vier
 * preenchida, retorna so a data (parseable por new Date() mesmo assim).
 *
 * Devolve a string NAIVA, sem fuso — quem marca o fuso e `comFusoSgp`, chamado
 * depois em cima do resultado (e tambem do fallback `os_data_agendamento`,
 * que nao passa por aqui). Separado de proposito: esta funcao so junta duas
 * strings, a semantica de fuso mora num unico lugar.
 */
function combineDateHora(obj: Record<string, any>, dataKey: string, horaKey: string): string | null {
  const data = pickString(obj, dataKey);
  if (!data) return null;
  const hora = pickString(obj, horaKey);
  return hora ? `${data}T${hora}` : data;
}

/**
 * Marca uma data/hora NAIVA do SGP com o fuso do Brasil (America/Fortaleza,
 * -03:00 fixo — o pais aboliu horario de verao em 2019; mesma decisao ja
 * documentada em routes/hora.ts).
 *
 * BUG que isto corrige: o SGP manda data/hora sem indicacao de fuso
 * ("2026-07-24T10:57:51"). Sem marcar isso explicitamente, `new Date(...)`
 * interpreta a string como hora LOCAL DO PROCESSO — e o container roda sem
 * `TZ` configurada, ou seja, em UTC. Toda `dataCadastro`/`dataAgendamento`
 * sincronizada ficava gravada 3h ADIANTADA: uma OS aberta as 10:57 BRT virava
 * 10:57 UTC, que e 07:57 BRT — "aberta ha" inflava em +3h (o card mostrava
 * horas de atraso numa OS aberta ha 15 minutos), e o mesmo campo alimenta o
 * alerta de SLA (slaAlertService.ts), que passava a disparar 3h cedo demais.
 *
 * So AFIXA o fuso, nunca reinterpreta um valor que ja tem um (`Z` ou
 * `+hh:mm`/`-hh:mm`) — protege contra double-offset se algum dia uma
 * instancia do SGP passar a mandar ISO completo.
 */
function comFusoSgp(dataHora: string | null): string | null {
  if (!dataHora) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(dataHora)) return dataHora;
  const comT = dataHora.includes(" ") && !dataHora.includes("T") ? dataHora.replace(" ", "T") : dataHora;
  return comT.includes("T") ? `${comT}${FUSO_SGP}` : `${comT}T00:00:00${FUSO_SGP}`;
}

const FUSO_SGP = "-03:00";

/**
 * Normaliza uma OS do SGP para o formato neutro do conector.
 * Defensivo quanto a nomes de campo: o SGP tem variantes entre a familia
 * "URA" e a familia "central/chamado" (ex.: os_id vs id, os_conteudo vs
 * conteudo), entao aceitamos os aliases mais comuns documentados.
 */
function statusCodeDe(raw: Record<string, any>): number | string {
  const bruto = pick(raw, "os_status", "status_id", "status");
  if (bruto !== null && bruto !== undefined) return bruto;
  console.warn(
    `[sgp] OS ${pick(raw, "os_id", "id") ?? "?"} sem os_status/status_id/status — assumindo Aberta. ` +
      "Formato do SGP pode ter mudado.",
  );
  return 0;
}

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
    //
    // O `?? 0` (Aberta) e um fallback SILENCIOSO por padrao — `sgpStatusReconhecido(0)`
    // e `true`, entao esse caso nao aparecia no aviso de "status nao reconhecido"
    // do sync. Se o registro nao trouxe nenhuma das tres chaves, e o formato do
    // SGP que mudou, nao um "esta aberta" de verdade — grita alto pra nao passar
    // despercebido de novo.
    statusCode: statusCodeDe(raw),
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
    dataCadastro: comFusoSgp(combineDateHora(raw, "data_cadastro", "hora_cadastro")),
    dataAgendamento: comFusoSgp(
      combineDateHora(raw, "data_agendamento", "hora_agendamento") ?? pickString(raw, "os_data_agendamento"),
    ),
    // Tecnico designado no SGP (pessoal do provedor) — so informativo; o
    // despacho de verdade e feito na ISPhub, com tecnicos proprios.
    tecnicoSgpNome: pickString(raw, "os_tecnico_responsavel", "tecnico"),
  };
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

    /**
     * Lista OS SEGUINDO A PAGINACAO ate o fim.
     *
     * Antes pedia uma pagina e ficava com ela. O SGP devolve
     * `paginacao.total`, entao tudo que passasse do tamanho de pagina
     * simplesmente NUNCA sincronizava: a OS ficava congelada no espelho no
     * ultimo status conhecido, e uma acao nela batia num 404 do SGP ("OS nao
     * encontrada") porque de fato ja tinha mudado por la. Espelho parcial e
     * pior que espelho vazio — ele parece completo.
     *
     * Quando o `offset` explicito e passado (uso pontual), respeita e nao
     * pagina: quem pediu uma janela especifica quer aquela janela.
     */
    async listServiceOrders(params: ListOsParams = {}): Promise<ListagemOs> {
      const path = "/api/ura/ordemservico/list/";
      const limite = params.limit ?? PAGINA_OS;
      const paginaUnica = params.offset !== undefined;

      const itens: any[] = [];
      let offset = params.offset ?? 0;
      let total: number | null = null;
      // `false` quando a coleta para sem ter certeza de ter tudo — hoje so o
      // teto de paginas. E o que a reconciliacao de status usa pra decidir se
      // pode confiar na AUSENCIA de uma OS (ver a trava em syncService.ts).
      let completo = true;

      for (let pagina = 0; pagina < PAGINACAO_MAX_PAGINAS; pagina++) {
        const data = await sgpPostJson(creds, path, {
          status: params.status,
          motivo: params.motivo,
          contrato: params.contrato,
          offset,
          limit: limite,
        });
        const lote = asArray(data, "ordens_servicos", "resultados");

        // O objetivo do debug e descobrir NOMES DE CAMPO do SGP, nunca os
        // valores. Antes isto despejava o registro cru inteiro — nome,
        // CPF/CNPJ, endereco e telefone do assinante — nos logs do container, a
        // cada ciclo de sync de cada provedor. Agora sai so o formato, e so na
        // 1a pagina.
        if (env.SGP_DEBUG_RAW && pagina === 0 && lote[0]) {
          console.log("[sgp-debug] campos da os:", JSON.stringify(Object.keys(lote[0] as object).sort()));
        }

        itens.push(...lote);
        if (paginaUnica) break;

        if (total === null) total = numeroOuNull((data as any)?.paginacao?.total);
        // Para quando: veio pagina vazia/incompleta (fim natural) ou ja se tem
        // o total anunciado. Sem `total`, o fim e a pagina incompleta — cobre
        // instancia que nao anuncia paginacao.
        if (lote.length < limite) break;
        if (total !== null && itens.length >= total) break;
        offset += limite;

        /*
         * Teto de paginas alcancado com MAIS coisa pra vir. Grita, porque o
         * sintoma disso e "a quantidade nao bate com o SGP" — e sem este aviso
         * era indistinguivel de qualquer outra causa. `PAGINACAO_MAX_PAGINAS *
         * PAGINA_OS` = 10.000 por status: o historico de encerradas de um
         * provedor grande passa disso com folga.
         */
        if (pagina === PAGINACAO_MAX_PAGINAS - 1) {
          completo = false;
          console.warn(
            `[sgp] ${path} status=${params.status ?? "todos"}: PAROU NO TETO DE ${PAGINACAO_MAX_PAGINAS} paginas ` +
              `com ${itens.length} de ${total ?? "?"} — o SGP tem MAIS OS do que o sync trouxe`,
          );
        }
      }

      /*
       * Quantas OS o SGP devolveu, por status. Faltava exatamente isto: quando
       * alguem diz "a contagem esta diferente do SGP", nao havia como saber se
       * o ISPhub recebeu menos, recebeu tudo e classificou diferente, ou se o
       * numero comparado era outra coisa. Uma linha por status por ciclo.
       */
      /*
       * Alem da contagem, a ORDEM em que o SGP devolve — so id e data, nunca
       * dado de assinante. Sem isso a truncagem e ambigua: pegando as 10.000
       * PRIMEIRAS de 72.230, se a lista vier da mais antiga pra mais nova, o
       * que o sync recebe e arqueologia e nenhuma OS recem-encerrada chega —
       * ela fica aberta no espelho pra sempre. Se vier da mais nova pra mais
       * antiga, o corte e inofensivo. Sao correcoes opostas, e chutar errado
       * aqui custa caro.
       */
      const idDe = (o: any) => pick(o ?? {}, "os_id", "id");
      const dataDe = (o: any) => pickString(o ?? {}, "os_data_cadastro", "data_cadastro", "os_data_abertura");
      console.log(
        `[sgp] ${path} status=${params.status ?? "todos"}: ${itens.length} OS` +
          `${total !== null ? ` (paginacao.total=${total})` : " (sem paginacao.total no payload)"}` +
          `${itens.length > 1 ? ` — 1o: id=${idDe(itens[0])} ${dataDe(itens[0]) ?? "?"} | ultimo: id=${idDe(itens[itens.length - 1])} ${dataDe(itens[itens.length - 1]) ?? "?"}` : ""}`,
      );

      /*
       * Registro sem `os_id` NEM `id` — `String(pick(...))` viraria a string
       * literal "null", e OS distintas colapsariam na mesma linha do banco
       * (a chave do upsert e provedorId+sgpOsId). Descarta com log alto em vez
       * de gravar lixo; melhor faltar uma OS suspeita que fundir varias.
       */
      const validos = itens.filter((o) => {
        if (idDe(o) !== null && idDe(o) !== undefined) return true;
        console.error(`[sgp] ${path}: registro sem os_id/id descartado — ${JSON.stringify(Object.keys(o ?? {}))}`);
        return false;
      });

      return { itens: validos.map(normalizeOs), total, completo: paginaUnica ? true : completo };
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

    async updateOsStatus(sgpOsId: string, statusCode: number): Promise<void> {
      const path = `/api/os/update/id/${encodeURIComponent(sgpOsId)}/`;
      try {
        // SO `os_status`. A doc de "Alterar Ordem de Servico" lista todo o
        // resto (servico prestado, observacao, checkin, assinaturas,
        // classificacoes, datas) como OPCIONAL — e mudar status no ISPhub e
        // exatamente isso: mudar o status, sem pedir nada a quem clica.
        //
        // Antes iam mais dois campos que ninguem pediu:
        //  - `os_data_alteracao`: puro ruido. O SGP estampa o proprio horario
        //    de alteracao; estavamos informando a hora em que a chamada saiu.
        //  - `os_data_finalizacao`: o SGP registra a finalizacao ao encerrar.
        //    Mandar a nossa data por cima nao acrescenta nada e faz a chamada
        //    parecer um "encerramento completo" em vez de uma troca de status.
        //
        // JSON, nao form-urlencoded: a doc e explicita (`Content-Type:
        // application/json`). Como form, o SGP responde 200 e ignora o corpo
        // inteiro — o status nao mudava, sem erro nenhum pra denunciar.
        const data = await sgpPostJson(creds, path, { os_status: statusCode });
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

    /**
     * Ficha completa da OS. O endpoint devolve um ARRAY com um item (formato da
     * doc "Ordem de Servico por ID"), entao pega o primeiro; array vazio =
     * o SGP nao conhece essa OS.
     *
     * POST com app+token no corpo, como a doc pede — nao e um GET, apesar do
     * nome "list".
     */
    async obterFichaOs(sgpOsId: string, contratoId?: string | null): Promise<OsFichaSgp | null> {
      const path = `/api/os/list/id/${encodeURIComponent(sgpOsId)}/`;

      // DUAS fontes, em paralelo:
      //  - a OS (`/api/os/list/id/`): motivo, servico prestado, equipe, setor;
      //  - o CADASTRO do contrato (`/api/ura/clientes/`): e de onde sai o PPPoE
      //    de verdade. Descoberto comparando com o app da CITmax, que resolve o
      //    login por `servico_login` do cadastro (com `contratoCentralLogin` de
      //    reserva) — nao pelo endpoint da OS, que em varias instancias nao
      //    devolve esses campos. Buscar so na OS era o motivo de a ficha vir
      //    sem PPPoE.
      const [dataOs, dataCliente] = await Promise.all([
        // `.catch` nas DUAS: sao fontes independentes, e `/api/os/` e outra
        // familia de API que a do sync (`/api/ura/`) — pode nao estar liberada
        // na instancia do provedor, ou nao devolver OS ja encerrada. Deixar uma
        // derrubar a outra era o motivo de a ficha inteira sumir quando o
        // PPPoE e o cadastro tinham chegado sem problema.
        sgpPostForm(creds, path).catch(() => null),
        contratoId
          ? sgpPostForm(creds, "/api/ura/clientes/", { contrato: contratoId, limit: 1 }).catch(() => null)
          : Promise.resolve(null),
      ]);

      const [itemOs] = asArray(dataOs, "ordens_servicos", "resultados", "results");
      const cliente = Array.isArray(dataCliente?.clientes) ? dataCliente.clientes[0] : undefined;

      /*
       * Null so quando NENHUMA das duas fontes trouxe nada. Antes bastava a OS
       * vir vazia pra devolver null, e o cliente exibia "esta OS nao existe
       * mais no SGP" — uma afirmacao que o dado nao sustenta: pode ser OS
       * encerrada, endpoint indisponivel ou envelope diferente. Quem prova
       * ausencia de verdade e a deteccao de removidas do sync, que marca
       * CANCELADA e registra o evento.
       */
      if (!itemOs && !cliente) return null;

      // `item` como objeto vazio quando a OS nao veio: os `pickString(item, ...)`
      // abaixo continuam validos e a parte do cadastro e entregue igual.
      const item = itemOs ?? {};
      const contrato = cliente?.contratos?.[0];
      const servico = contrato?.servicos?.[0];
      const onu = servico?.onu;
      const rx = numeroOuNull(onu?.rx);
      const tx = numeroOuNull(onu?.tx);

      const auxiliares = pick(item, "os_tecnicos_auxiliares");
      return {
        clienteNome: pickString(cliente ?? {}, "nome", "razaoSocial", "razao_social") ?? pickString(item, "cliente"),
        clienteDocumento: pickString(cliente ?? {}, "cpfcnpj", "cpf_cnpj", "documento"),
        clienteEmail: pickString(cliente ?? {}, "email") ?? pickString(item, "cliente_email"),
        contratoStatus:
          pickString(contrato ?? {}, "contratoStatusDisplay", "status", "contrato_status") ??
          pickString(item, "contrato_status"),
        // Plano: cadastro primeiro (e a fonte viva do contrato), OS como reserva.
        // `servico_plano` chega como OBJETO em alguma instancias (visto na
        // NetGo) — `nomeDoPlano` resolve os dois formatos. Velocidades podem
        // estar soltas no servico OU dentro desse mesmo objeto.
        plano: nomeDoPlano(pick(servico ?? {}, "servico_plano", "plano")) ?? pickString(item, "plano"),
        planoDownload:
          pickString(servico ?? {}, "plano_download", "download") ??
          pickString((pick(servico ?? {}, "servico_plano", "plano") ?? {}) as Record<string, any>, "download", "velocidade_download") ??
          pickString(item, "plano_download"),
        planoUpload:
          pickString(servico ?? {}, "plano_upload", "upload") ??
          pickString((pick(servico ?? {}, "servico_plano", "plano") ?? {}) as Record<string, any>, "upload", "velocidade_upload") ??
          pickString(item, "plano_upload"),
        // `servico_login` e o PPPoE real; `contratoCentralLogin` e o login da
        // central do assinante — serve de reserva, mas nunca tem prioridade.
        servicoLogin:
          pickString(servico ?? {}, "servico_login", "login") ??
          pickString(contrato ?? {}, "contratoCentralLogin") ??
          pickString(item, "servico_login"),
        servicoSenha: pickString(servico ?? {}, "servico_password", "senha") ?? pickString(item, "servico_password"),
        // O SGP manda booleano de verdade aqui; null quando nem informa.
        servicoOnline: typeof item.servico_online === "boolean" ? item.servico_online : null,
        // `servico_online_ip` e o IP da sessao ATIVA; `servico_ip` e o cadastrado.
        // Pro tecnico o que vale e o de agora, com o cadastrado como reserva.
        servicoIp: pickString(item, "servico_online_ip", "servico_ip"),
        servicoMac: pickString(item, "servico_online_mac", "servico_mac"),
        enderecoComplemento: pickString(item, "endereco_complemento"),
        enderecoPontoReferencia: pickString(item, "endereco_pontoreferencia"),
        servicoPrestado: pickString(item, "os_servicoprestado"),
        observacao: pickString(item, "os_observacao"),
        tecnicoResponsavel: pickString(item, "os_tecnico_responsavel"),
        tecnicosAuxiliares: Array.isArray(auxiliares) ? auxiliares.map(String).filter(Boolean) : [],
        setor: pickString(item, "os_setor"),
        // `cliente` e undefined quando a OS nao tem contrato ou o cadastro
        // falhou — o `?? {}` evita quebrar a ficha inteira por causa disso.
        clienteContato: pickString(item, "cliente_contato") ?? extrairTelefoneCliente(cliente ?? {}),
        sinalRxDbm: rx,
        sinalTxDbm: tx,
        oltNome: pickString(onu ?? {}, "olt_nome"),
      };
    },

    /**
     * Sem `try`/`catch` de proposito: ver a nota do metodo na interface. `null`
     * so quando o SGP respondeu e nao havia OS com esse id.
     */
    async obterStatusOs(sgpOsId: string): Promise<number | string | null> {
      const data = await sgpPostForm(creds, `/api/os/list/id/${encodeURIComponent(sgpOsId)}/`);
      const [item] = asArray(data, "ordens_servicos", "resultados", "results");
      if (!item) return null;
      return statusCodeDe(item);
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
        let cliente = await buscarClientePorContrato(creds, contratoId);

        /*
         * FALLBACK pra contrato INATIVO/CANCELADO.
         *
         * `/api/ura/clientes/` nao aceita filtro de status e, na pratica, nao
         * devolve contrato fora de "ativo" — e por isso que uma OS de contrato
         * inativo aparecia sem CONTATO no card (visto na OS #6720, "Contrato
         * Inativo", contato vazio). O cadastro existe; e a consulta que nao
         * alcanca.
         *
         * `/api/ura/consultacliente/` aceita `status` (1=Ativo, 2=Inativo,
         * 3=Cancelado, 4=Suspenso, 5=Inviabilidade, 6=Novo, 7=Ativo V.
         * Reduzida), entao pedindo os sete cobre qualquer situacao.
         *
         * So roda quando a primeira consulta nao resolveu (sem cliente, ou
         * cliente sem telefone) — o caso comum (contrato ativo) segue com UMA
         * chamada. E estritamente ADITIVO: se este endpoint responder num
         * formato diferente do esperado, os extratores devolvem null e o
         * resultado e o mesmo de hoje, nunca pior.
         */
        if (!cliente || !extrairTelefoneCliente(cliente)) {
          const doFallback = await buscarClientePorContratoQualquerStatus(creds, contratoId);
          // Fica com o que tiver telefone; na duvida, o primeiro (mais completo
          // pro contrato ativo).
          if (doFallback && (!cliente || extrairTelefoneCliente(doFallback))) cliente = doFallback;
        }

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
