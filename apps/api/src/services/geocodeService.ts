/**
 * Geocodificação reversa com cache em memória (inspirado no Traccar).
 *
 * Arredonda lat/lng para 4 casas decimais (~11 m) para maximizar reuso de cache
 * e respeita o intervalo mínimo de 1.1s entre requisições ao Nominatim.
 */

interface EntradaCache {
  endereco: string | null;
  expiraEm: number;
}

const TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_ENTRADAS = 2000;
const INTERVALO_MIN_MS = 1100;

const cache = new Map<string, EntradaCache>();
let ultimaRequisicaoMs = 0;

function chave(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function formatarNominatim(address?: Record<string, string>, displayName?: string): string | null {
  if (!address) return displayName ?? null;
  const rua = address.road || address.pedestrian || address.footway || address.highway;
  const numero = address.house_number;
  const bairro = address.suburb || address.neighbourhood || address.quarter;
  const cidade = address.city || address.town || address.village || address.municipality;
  const uf = address.state_code || address.state;

  const partes: string[] = [];
  if (rua) partes.push(numero ? `${rua}, ${numero}` : rua);
  if (bairro) partes.push(bairro);
  if (cidade) partes.push(uf ? `${cidade}/${uf}` : cidade);

  return partes.length > 0 ? partes.join(" — ") : (displayName ?? null);
}

export async function reverterCoordenada(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const k = chave(lat, lng);
  const agora = Date.now();
  const cached = cache.get(k);
  if (cached && cached.expiraEm > agora) {
    return cached.endereco;
  }

  const espera = ultimaRequisicaoMs + INTERVALO_MIN_MS - agora;
  if (espera > 0) {
    await new Promise((r) => setTimeout(r, espera));
  }
  ultimaRequisicaoMs = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ISPhub/1.0 (gestao-frota)",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: Record<string, string>; display_name?: string };
    const endereco = formatarNominatim(data.address, data.display_name);

    if (cache.size >= MAX_ENTRADAS) {
      const primeira = cache.keys().next().value;
      if (primeira) cache.delete(primeira);
    }
    cache.set(k, { endereco, expiraEm: Date.now() + TTL_MS });
    return endereco;
  } catch {
    return null;
  }
}
