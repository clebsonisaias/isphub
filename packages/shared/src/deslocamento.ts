import { distanciaTotalMetros, haversineMetros, type Ponto, type PontoNoTempo } from "./geodesia.js";

/**
 * Quanto a viatura rodou ATE uma OS — do fim da parada anterior (ou do inicio
 * da jornada) ate o inicio desta. "Durante a OS" nao interessa: a visita e
 * parada; o custo esta no trajeto entre uma e outra.
 */
export type FonteDeslocamento = "gps" | "estimado" | "sem_dados";

export interface MedidaDeslocamento {
  metros: number;
  pontos: number;
  fonte: FonteDeslocamento;
}

/** Pontos/minuto abaixo disto a serie e esparsa demais pra somar trechos. */
export const DENSIDADE_MINIMA_PONTOS_POR_MIN = 1 / 3;

export function densidadeSuficiente(pontos: number, inicio: Date, fim: Date): boolean {
  const minutos = Math.max(1, (fim.getTime() - inicio.getTime()) / 60_000);
  return pontos / minutos >= DENSIDADE_MINIMA_PONTOS_POR_MIN;
}

/**
 * Mede o deslocamento. Com 2+ posicoes do veiculo no intervalo, soma os trechos
 * (GPS). Sem serie, estima pela reta entre a parada anterior e o endereco da OS
 * vezes um fator de rua (1,3). Sem nem isso, declara `sem_dados` — nunca zero
 * disfarcado de medida.
 */
export function medirDeslocamento(args: {
  posicoes: PontoNoTempo[];
  origemFallback?: Ponto | null;
  destinoFallback?: Ponto | null;
}): MedidaDeslocamento {
  const pts = [...args.posicoes].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  if (pts.length >= 2) {
    return { metros: Math.round(distanciaTotalMetros(pts)), pontos: pts.length, fonte: "gps" };
  }
  if (args.origemFallback && args.destinoFallback) {
    return {
      metros: Math.round(haversineMetros(args.origemFallback, args.destinoFallback) * FATOR_RUA),
      pontos: pts.length,
      fonte: "estimado",
    };
  }
  return { metros: 0, pontos: pts.length, fonte: "sem_dados" };
}

/** Reta x 1,3 ~ distancia por rua em malha urbana. Grosseiro de proposito: e so o fallback. */
export const FATOR_RUA = 1.3;

export function formatarKm(metros: number): string {
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}
