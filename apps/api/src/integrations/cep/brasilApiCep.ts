import type { EnderecoCep } from "../types.js";

interface BrasilApiCepResponse {
  cep: string;
  state: string;
  city: string;
  neighborhood: string;
  street: string;
  service?: string;
  location?: {
    type?: string;
    coordinates?: {
      longitude?: string | number;
      latitude?: string | number;
    };
  };
}

export async function buscarCepBrasilApi(cep: string, timeoutMs = 3500): Promise<EnderecoCep | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`, {
      headers: { "User-Agent": "ISPhub-IntegrationHub/1.0" },
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as BrasilApiCepResponse;

    let lat: number | null = null;
    let lng: number | null = null;

    if (data.location?.coordinates) {
      const parsedLat = Number.parseFloat(String(data.location.coordinates.latitude ?? ""));
      const parsedLng = Number.parseFloat(String(data.location.coordinates.longitude ?? ""));
      if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)) {
        lat = parsedLat;
        lng = parsedLng;
      }
    }

    return {
      cep: digits,
      logradouro: data.street || "",
      bairro: data.neighborhood || "",
      cidade: data.city || "",
      estado: data.state || "",
      lat,
      lng,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
