import type { FilaFiltros } from "@isphub/shared";

/**
 * Cliente da API ISPhub. O app e CLIENTE — nao fala com o SGP direto nem
 * reimplementa regra. Base URL vem de EXPO_PUBLIC_API_URL (baked no build);
 * fallback pra API local no dev.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

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

export async function apiFetch<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
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
  const s = p.toString();
  return s ? `?${s}` : "";
}
