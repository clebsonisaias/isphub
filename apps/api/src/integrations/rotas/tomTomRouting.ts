import { haversineMetros } from "@isphub/shared";

export interface RotaTransitoResultado {
  distanciaMetros: number;
  distanciaKm: number;
  distanciaTexto: string;
  tempoSegundos: number;
  tempoMinutos: number;
  faixaMinutos: string;
  atrasoTransitoSegundos: number;
  origem: "tomtom_ao_vivo" | "calculo_local";
}

const TOMTOM_DEFAULT_KEY = "5jW3vl4d6DeADyg089hZP8PtzERtXaiM";

/**
 * Formata minutos em uma faixa amigável para o cliente (ex: "15 a 20 minutos").
 */
export function formatarFaixaMinutos(minutos: number): string {
  if (minutos <= 5) return "5 a 10 minutos";
  if (minutos <= 15) return `${minutos} a ${minutos + 5} minutos`;
  const base = Math.floor(minutos / 5) * 5;
  return `${base} a ${base + 5} minutos`;
}

/**
 * Calcula a rota entre dois pontos considerando trânsito em tempo real via TomTom Routing API.
 * Se a API da TomTom oscilar ou não responder em até 3 segundos, faz fallback automático
 * para a estimativa de malha viária urbana local.
 */
export async function calcularRotaComTransito(
  origem: { lat: number; lng: number } | null | undefined,
  destino: { lat: number; lng: number } | null | undefined,
): Promise<RotaTransitoResultado | null> {
  if (!origem || !destino || !origem.lat || !origem.lng || !destino.lat || !destino.lng) {
    return null;
  }

  // Validação básica de limites
  const metrosLinhaReta = haversineMetros(origem, destino);
  if (metrosLinhaReta < 20 || metrosLinhaReta > 120_000) {
    return null;
  }

  const apiKey = process.env.TOMTOM_API_KEY || TOMTOM_DEFAULT_KEY;

  if (apiKey) {
    try {
      const url = `https://api.tomtom.com/routing/1/calculateRoute/${origem.lat},${origem.lng}:${destino.lat},${destino.lng}/json?key=${apiKey}&traffic=true`;
      const response = await fetch(url, { signal: AbortSignal.timeout(3500) });

      if (response.ok) {
        const data = (await response.json()) as any;
        const summary = data?.routes?.[0]?.summary;

        if (summary && typeof summary.lengthInMeters === "number" && typeof summary.travelTimeInSeconds === "number") {
          const distanciaMetros = summary.lengthInMeters;
          const tempoSegundos = summary.travelTimeInSeconds;
          const atrasoTransitoSegundos = summary.trafficDelayInSeconds ?? 0;

          const distanciaKm = Math.round((distanciaMetros / 1000) * 10) / 10;
          const tempoMinutos = Math.max(3, Math.round(tempoSegundos / 60));

          const distanciaTexto =
            distanciaKm < 1
              ? `${Math.round(distanciaMetros)} metros`
              : `${distanciaKm.toFixed(1).replace(".", ",")} km`;

          return {
            distanciaMetros,
            distanciaKm,
            distanciaTexto,
            tempoSegundos,
            tempoMinutos,
            faixaMinutos: formatarFaixaMinutos(tempoMinutos),
            atrasoTransitoSegundos,
            origem: "tomtom_ao_vivo",
          };
        }
      }
    } catch (err) {
      console.warn("[tomtom-routing] Falha ao consultar TomTom, acionando fallback local:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback: cálculo de malha viária urbana local (1.35x distância direta a 28 km/h)
  const distKmReal = Math.round(((metrosLinhaReta * 1.35) / 1000) * 10) / 10;
  const minutosCalculados = Math.max(3, Math.round((distKmReal / 28) * 60));

  const distanciaTexto =
    distKmReal < 1
      ? `${Math.round(metrosLinhaReta * 1.35)} metros`
      : `${distKmReal.toFixed(1).replace(".", ",")} km`;

  return {
    distanciaMetros: Math.round(metrosLinhaReta * 1.35),
    distanciaKm: distKmReal,
    distanciaTexto,
    tempoSegundos: minutosCalculados * 60,
    tempoMinutos: minutosCalculados,
    faixaMinutos: formatarFaixaMinutos(minutosCalculados),
    atrasoTransitoSegundos: 0,
    origem: "calculo_local",
  };
}
