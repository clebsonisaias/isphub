import * as FileSystem from "expo-file-system/legacy";
import type { FilaFiltros } from "@isphub/shared";
import { API_BASE } from "./api-base";
import { getAccessToken, renovarSessao } from "./sessao";

/**
 * Cliente da API ISPhub. O app e CLIENTE — nao fala com o SGP direto nem
 * reimplementa regra.
 */
export { API_BASE };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOpts {
  token?: string | null;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Rotas onde renovar seria recursao ou nao faz sentido: `/auth/refresh` cairia
 * em laco infinito, e login/logout nao dependem de access token valido.
 */
const SEM_RENOVACAO = ["/auth/login", "/auth/refresh", "/auth/logout"];

export async function apiFetch<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const enviar = (token: string | null | undefined) =>
    fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

  let res = await enviar(opts.token);

  /*
   * UMA tentativa, nunca um laco: se a renovacao nao resolveu, o 401 e real e
   * tem que chegar na tela. Laco viraria tempestade contra /auth/refresh, que
   * tem refreshLimiter justamente pra isso.
   *
   * O retry usa `getAccessToken()` e NAO o `opts.token` recebido — aquele e o
   * token velho que o React ainda tem na mao. Reenviar o velho garantiria
   * outro 401.
   */
  if (res.status === 401 && opts.token && !SEM_RENOVACAO.includes(path)) {
    if (await renovarSessao()) res = await enviar(getAccessToken());
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch {
      // corpo nao-JSON — mantem a mensagem HTTP
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Baixa um anexo autenticado (foto/audio do chat) pra um arquivo local em
 * cache e devolve a URI local. `<Image>`/o player de audio nunca conseguem
 * mandar um header Authorization sozinhos — por isso o download manual em
 * vez de passar a URL remota direto pro componente. Cacheia por nome de
 * arquivo derivado do path (a rota ja usa o id da mensagem), entao tocar de
 * novo nao baixa de novo.
 */
export async function baixarAnexoAutenticado(path: string, token: string | null): Promise<string> {
  const nomeArquivo = path.replace(/[^a-zA-Z0-9]/g, "_");
  const destino = `${FileSystem.cacheDirectory}${nomeArquivo}`;
  const info = await FileSystem.getInfoAsync(destino);
  if (info.exists) return destino;
  const resultado = await FileSystem.downloadAsync(`${API_BASE}${path}`, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return resultado.uri;
}

/**
 * Serializa FilaFiltros em query string (manual — igual ao buildQuery do web).
 * Na fila do tecnico o escopo ja e server-side; aqui so passamos equipe/grupo/busca.
 */
export function buildFilaQuery(filtros: FilaFiltros): string {
  const p = new URLSearchParams();
  if (filtros.provedorId) p.set("provedorId", filtros.provedorId);
  if (filtros.status?.length) p.set("status", filtros.status.join(","));
  if (filtros.tipoOsId) p.set("tipoOsId", filtros.tipoOsId);
  if (filtros.categoriaId) p.set("categoriaId", String(filtros.categoriaId));
  if (filtros.grupo) p.set("grupo", filtros.grupo);
  if (filtros.equipe) p.set("equipe", filtros.equipe);
  if (filtros.busca) p.set("busca", filtros.busca);
  /*
   * `de`/`ate` recortam por `dataAgendamento` — e o que sustenta a "agenda do
   * dia". O filtro sempre existiu no servidor (routes/fila.ts, que ate ordena
   * por esse campo); faltava so serializar aqui, entao a agenda era inalcancavel
   * pelo app sem nenhuma razao de produto.
   */
  if (filtros.de) p.set("de", filtros.de);
  if (filtros.ate) p.set("ate", filtros.ate);
  // A agenda ISPhub (visita marcada no painel), que vence a data do SGP.
  if (filtros.diaAgenda) p.set("diaAgenda", filtros.diaAgenda);
  const s = p.toString();
  return s ? `?${s}` : "";
}
