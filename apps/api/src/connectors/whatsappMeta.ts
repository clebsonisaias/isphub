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

export interface BotaoWhatsapp {
  id: string;
  titulo: string;
}

/**
 * Envia mensagem interativa com botões de resposta rápida (Quick Reply).
 * A Meta Cloud API permite no máximo 3 botões, com títulos de até 20 caracteres cada.
 */
export async function enviarBotoes(
  config: MetaConfig,
  telefone: string,
  corpo: string,
  botoes: BotaoWhatsapp[],
  cabecalho?: string,
  rodape?: string,
): Promise<EnviarResultado> {
  try {
    const data = await metaPostJson(config, `/${config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizarTelefoneBR(telefone),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: corpo },
        ...(cabecalho ? { header: { type: "text", text: cabecalho } } : {}),
        ...(rodape ? { footer: { text: rodape } } : {}),
        action: {
          buttons: botoes.slice(0, 3).map((b) => ({
            type: "reply",
            reply: {
              id: b.id,
              title: b.titulo.slice(0, 20),
            },
          })),
        },
      },
    });
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar botões interativos" };
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

// ── Templates HSM ────────────────────────────────────────────────────────────
// Fora da janela de 24h a Meta so aceita template aprovado. O catalogo e lido AO
// VIVO da Graph API (nao ha tabela local): a Meta pode reprovar um template a
// qualquer momento e uma copia local envelheceria em silencio.

/** Definicao de um template aprovado, ja reduzida ao que o disparo precisa. */
export interface TemplateWhatsappDef {
  nome: string;
  /** `language` da definicao aprovada. Fixar "pt_BR" quebra template em outro idioma. */
  idioma: string;
  categoria: string;
  /** Texto do BODY com os `{{n}}` ainda no lugar. */
  corpo: string;
  /** Texto do HEADER so quando `format === "TEXT"`; header de midia nao entra. */
  header: string | null;
  /** Indices `{{n}}` de header+corpo, ordenados e sem repeticao. */
  variaveis: number[];
}

/** Parametro posicional de um componente de template — a Meta so aceita texto aqui. */
export interface ParametroTemplate {
  type: "text";
  text: string;
}

export interface ComponenteTemplate {
  type: "header" | "body";
  parameters: ParametroTemplate[];
}

interface ComponenteBruto {
  type?: string;
  format?: string;
  text?: string;
}

interface TemplateBruto {
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  components?: ComponenteBruto[];
}

interface RespostaCatalogo {
  data?: TemplateBruto[];
  paging?: { next?: string; cursors?: { after?: string } };
}

const CAMPOS_TEMPLATE = "name,status,category,language,components";
const LIMITE_PAGINA = 100;
/** Trava contra cursor que nao avanca — 1000 templates ja e muito acima de um catalogo real. */
const MAX_PAGINAS_CATALOGO = 10;
const CATALOGO_TTL_MS = 5 * 60 * 1000;

interface EntradaCacheCatalogo {
  expiraEm: number;
  templates: TemplateWhatsappDef[];
}

const catalogoCache = new Map<string, EntradaCacheCatalogo>();

/** Invalida o catalogo em memoria (chamado quando o admin salva outro WABA/token). */
export function limparCacheTemplates(wabaId?: string): void {
  if (wabaId) catalogoCache.delete(wabaId);
  else catalogoCache.clear();
}

/** Indices `{{n}}` presentes no texto, ordenados e sem repeticao. */
export function extrairVariaveis(texto: string): number[] {
  const indices = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return [...new Set(indices)].sort((a, b) => a - b);
}

/**
 * A Meta recusa parametro com quebra de linha, tab ou 4+ espacos seguidos
 * (#131009) — colapsa qualquer espaco em branco num so. Valor vazio tambem e
 * recusado, entao vira um tratamento generico em vez de derrubar o disparo.
 */
export function sanitizarVariavel(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim() || "cliente";
}

function valorDaVariavel(vars: Record<string, string>, indice: number): string {
  return sanitizarVariavel(vars[String(indice)]);
}

/**
 * Componentes do payload de envio, derivados do texto aprovado. Componente sem
 * `{{n}}` fica de fora: mandar `parameters` nele da erro #132000 ("Number of
 * parameters does not match").
 */
export function montarComponents(def: TemplateWhatsappDef, vars: Record<string, string>): ComponenteTemplate[] {
  const componentes: ComponenteTemplate[] = [];
  const partes = [
    { tipo: "header" as const, texto: def.header },
    { tipo: "body" as const, texto: def.corpo },
  ];
  for (const { tipo, texto } of partes) {
    if (!texto) continue;
    const indices = extrairVariaveis(texto);
    if (!indices.length) continue;
    // Parametros sao posicionais: vao de 1 ate o maior indice mesmo que o texto
    // pule um numero, senao a Meta desalinha os valores.
    const maior = indices[indices.length - 1];
    const parameters: ParametroTemplate[] = [];
    for (let i = 1; i <= maior; i++) parameters.push({ type: "text", text: valorDaVariavel(vars, i) });
    componentes.push({ type: tipo, parameters });
  }
  return componentes;
}

function substituirPlaceholders(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{(\d+)\}\}/g, (_, indice: string) => valorDaVariavel(vars, Number(indice)));
}

/**
 * Texto final como o cliente vai ler (header + corpo), pro chamador gravar no
 * historico — a Meta so devolve o id da mensagem, nunca o texto renderizado.
 */
export function renderizarTemplate(def: TemplateWhatsappDef, vars: Record<string, string>): string {
  return [def.header, def.corpo]
    .filter((texto): texto is string => Boolean(texto && texto.trim()))
    .map((texto) => substituirPlaceholders(texto, vars))
    .join("\n\n");
}

/** null quando o template nao tem BODY de texto — sem corpo nao ha o que renderizar nem enviar. */
function mapearDefinicao(bruto: TemplateBruto): TemplateWhatsappDef | null {
  const componentes = bruto.components ?? [];
  const corpo = componentes.find((c) => c.type === "BODY")?.text ?? "";
  if (!bruto.name || !corpo.trim()) return null;
  // Header de imagem/video/documento nao tem texto e exige outro tipo de
  // parametro — fora do escopo do disparo por texto.
  const header = componentes.find((c) => c.type === "HEADER" && c.format === "TEXT")?.text ?? null;
  return {
    nome: bruto.name,
    idioma: bruto.language ?? "",
    categoria: bruto.category ?? "",
    corpo,
    header,
    variaveis: extrairVariaveis(`${header ?? ""}\n${corpo}`),
  };
}

/**
 * Catalogo de templates APROVADOS do WABA, com cache de 5 min por wabaId.
 * Template reprovado/pausado nunca chega ao chamador: seria uma opcao na UI que
 * so falha no disparo.
 */
export async function listarTemplates(config: MetaConfig, wabaId: string): Promise<TemplateWhatsappDef[]> {
  const chave = wabaId?.trim();
  if (!chave) {
    throw new MetaWhatsappError("WABA ID nao configurado no canal WhatsApp Oficial — sem ele nao da pra listar os templates aprovados.");
  }

  const cacheado = catalogoCache.get(chave);
  if (cacheado && cacheado.expiraEm > Date.now()) return cacheado.templates;

  const brutos: TemplateBruto[] = [];
  let after: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS_CATALOGO; pagina++) {
    const query = new URLSearchParams({ fields: CAMPOS_TEMPLATE, limit: String(LIMITE_PAGINA) });
    if (after) query.set("after", after);
    const resposta = (await metaGet(config, `/${encodeURIComponent(chave)}/message_templates?${query}`)) as RespostaCatalogo | null;
    brutos.push(...(resposta?.data ?? []));
    // `paging.cursors.after` vem ate na ultima pagina; so `next` indica que ha mais.
    if (!resposta?.paging?.next) break;
    after = resposta.paging.cursors?.after;
    if (!after) break;
  }

  const templates = brutos
    .filter((bruto) => bruto.status === "APPROVED")
    .map(mapearDefinicao)
    .filter((def): def is TemplateWhatsappDef => def !== null);

  catalogoCache.set(chave, { expiraEm: Date.now() + CATALOGO_TTL_MS, templates });
  return templates;
}

/** null quando o template nao existe OU nao esta aprovado — o chamador deve recusar o disparo, nunca chutar o payload. */
export async function obterTemplate(config: MetaConfig, wabaId: string, nome: string): Promise<TemplateWhatsappDef | null> {
  const templates = await listarTemplates(config, wabaId);
  return templates.find((def) => def.nome === nome) ?? null;
}

/**
 * Normaliza pro formato que a Cloud API aceita no `to`: so digitos, com DDI 55.
 * Idempotente — pode ser chamada de novo sobre um numero ja normalizado.
 */
export function normalizarTelefoneBR(bruto: string): string {
  let num = bruto.replace(/\D/g, "");
  if (num.startsWith("0")) num = num.slice(1);

  // Decidir pelo TAMANHO, nunca pelo prefixo. Testar `startsWith("55")` quebra
  // o DDD 55 (Santa Maria/RS e regiao): "55991234567" e um numero nacional
  // completo, e nao um numero de 9 digitos que ja viesse com DDI. Por tamanho
  // nao ha ambiguidade nenhuma no plano brasileiro:
  //   10 = DDD + 8      11 = DDD + 9      12 = 55 + DDD + 8      13 = 55 + DDD + 9
  // Idempotente: 12 e 13 digitos ja tem DDI e passam direto.
  if (num.length === 10 || num.length === 11) num = `55${num}`;

  // 55 + DDD + 8 digitos: celular no formato antigo, falta o 9o digito. Um fixo
  // de 8 digitos cai aqui tambem e ganha um 9 indevido — aceito de proposito,
  // porque fixo quase nunca tem WhatsApp e o pior caso e a Meta recusar o envio.
  if (num.length === 12 && !num.slice(4).startsWith("9")) num = `${num.slice(0, 4)}9${num.slice(4)}`;
  return num;
}

/**
 * Dispara um template a partir da definicao APROVADA (nunca de um palpite de
 * quantos parametros ele tem) e devolve o texto renderizado pro historico.
 */
export async function enviarTemplate(
  config: MetaConfig,
  telefone: string,
  def: TemplateWhatsappDef,
  vars: Record<string, string>,
): Promise<EnviarResultado & { corpoRenderizado: string }> {
  if (!def.idioma) {
    throw new MetaWhatsappError(`Template "${def.nome}" veio sem idioma na definicao aprovada — disparo cancelado pra nao mandar payload errado.`);
  }
  const corpoRenderizado = renderizarTemplate(def, vars);
  const components = montarComponents(def, vars);
  try {
    const data = await metaPostJson(config, `/${config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: normalizarTelefoneBR(telefone),
      type: "template",
      template: {
        name: def.nome,
        language: { code: def.idioma },
        ...(components.length ? { components } : {}),
      },
    });
    return { ok: true, waMessageId: data?.messages?.[0]?.id, corpoRenderizado };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar template", corpoRenderizado };
  }
}
