import { integrationCache } from "../cache.js";
import type { FeriadoNacional } from "../types.js";

const FERIADOS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export async function listarFeriados(ano: number, timeoutMs = 4000): Promise<FeriadoNacional[]> {
  if (!ano || ano < 2000 || ano > 2100) return [];

  const chave = `feriados:${ano}`;
  const emCache = integrationCache.get<FeriadoNacional[]>(chave);
  if (emCache) return emCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, {
      headers: { "User-Agent": "ISPhub-IntegrationHub/1.0" },
      signal: controller.signal,
    });

    if (!res.ok) return [];

    const data = (await res.json()) as FeriadoNacional[];
    if (Array.isArray(data) && data.length > 0) {
      integrationCache.set(chave, data, FERIADOS_CACHE_TTL_MS);
      return data;
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
