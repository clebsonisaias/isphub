import { integrationCache } from "../cache.js";
import type { ResultadoCep } from "../types.js";
import { buscarCepBrasilApi } from "./brasilApiCep.js";
import { buscarCepViaCep } from "./viaCep.js";

const CEP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export async function consultarCep(cepBruto: string): Promise<ResultadoCep | null> {
  const digits = cepBruto.replace(/\D/g, "");
  if (digits.length !== 8) {
    return null;
  }

  const chaveCache = `cep:${digits}`;
  const emCache = integrationCache.get<ResultadoCep>(chaveCache);
  if (emCache) {
    return {
      provedor: "cache",
      endereco: emCache.endereco,
    };
  }

  // 1. Tenta BrasilAPI v2 (primário - com suporte a coordenadas)
  const daBrasilApi = await buscarCepBrasilApi(digits);
  if (daBrasilApi) {
    const res: ResultadoCep = {
      provedor: "brasilapi",
      endereco: daBrasilApi,
    };
    integrationCache.set(chaveCache, res, CEP_CACHE_TTL_MS);
    return res;
  }

  // 2. Fallback para ViaCEP
  const doViaCep = await buscarCepViaCep(digits);
  if (doViaCep) {
    const res: ResultadoCep = {
      provedor: "viacep",
      endereco: doViaCep,
    };
    integrationCache.set(chaveCache, res, CEP_CACHE_TTL_MS);
    return res;
  }

  return null;
}
