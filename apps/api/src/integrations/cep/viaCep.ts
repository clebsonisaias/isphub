import type { EnderecoCep } from "../types.js";

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
  erro?: boolean | string;
}

export async function buscarCepViaCep(cep: string, timeoutMs = 3500): Promise<EnderecoCep | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { "User-Agent": "ISPhub-IntegrationHub/1.0" },
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as ViaCepResponse;
    if (data.erro === true || data.erro === "true") {
      return null;
    }

    return {
      cep: digits,
      logradouro: data.logradouro || "",
      complemento: data.complemento || "",
      bairro: data.bairro || "",
      cidade: data.localidade || "",
      estado: data.uf || "",
      ibge: data.ibge || undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
