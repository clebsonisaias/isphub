import { integrationCache } from "../cache.js";
import type { MunicipioIbge, UfIbge } from "../types.js";

const LOCALIDADES_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

interface IbgeUfResponse {
  id: number;
  sigla: string;
  nome: string;
}

interface IbgeMunicipioResponse {
  id: number;
  nome: string;
}

export async function listarUfs(timeoutMs = 5000): Promise<UfIbge[]> {
  const chave = "ibge:ufs";
  const emCache = integrationCache.get<UfIbge[]>(chave);
  if (emCache) return emCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome", {
      headers: { "User-Agent": "ISPhub-IntegrationHub/1.0" },
      signal: controller.signal,
    });

    if (!res.ok) return [];

    const data = (await res.json()) as IbgeUfResponse[];
    const ufs: UfIbge[] = data.map((u) => ({
      id: u.id,
      sigla: u.sigla,
      nome: u.nome,
    }));

    if (ufs.length > 0) {
      integrationCache.set(chave, ufs, LOCALIDADES_CACHE_TTL_MS);
    }
    return ufs;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function listarMunicipios(ufSigla: string, timeoutMs = 5000): Promise<MunicipioIbge[]> {
  const uf = ufSigla.trim().toUpperCase();
  if (!uf || uf.length !== 2) return [];

  const chave = `ibge:municipios:${uf}`;
  const emCache = integrationCache.get<MunicipioIbge[]>(chave);
  if (emCache) return emCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`, {
      headers: { "User-Agent": "ISPhub-IntegrationHub/1.0" },
      signal: controller.signal,
    });

    if (!res.ok) return [];

    const data = (await res.json()) as IbgeMunicipioResponse[];
    const municipios: MunicipioIbge[] = data.map((m) => ({
      id: m.id,
      nome: m.nome,
    }));

    if (municipios.length > 0) {
      integrationCache.set(chave, municipios, LOCALIDADES_CACHE_TTL_MS);
    }
    return municipios;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
