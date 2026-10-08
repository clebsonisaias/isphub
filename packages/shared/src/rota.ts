import { haversineMetros } from "./geodesia.js";

/** Uma parada candidata a ordenacao. Sem coordenada, vai pro fim na ordem em que veio. */
export interface ParadaRota {
  id: string;
  lat: number | null;
  lng: number | null;
}

export interface SugestaoRota {
  /** Ids na ordem sugerida — as sem coordenada por ultimo, na ordem original. */
  ordem: string[];
  /** Percurso estimado (reta entre pontos consecutivos, a partir da origem), em metros. */
  metros: number;
  semCoordenada: number;
}

type ComCoord = { id: string; lat: number; lng: number };

function temCoord(p: ParadaRota): p is ParadaRota & ComCoord {
  return p.lat != null && p.lng != null;
}

/** Percurso de uma ordem dada, a partir da origem, so entre quem tem coordenada. */
export function metrosDaOrdem(paradas: ParadaRota[], origem: { lat: number; lng: number } | null): number {
  const pts = paradas.filter(temCoord);
  let total = 0;
  let atual: { lat: number; lng: number } | null = origem;
  for (const p of pts) {
    if (atual) total += haversineMetros(atual, p);
    atual = p;
  }
  return Math.round(total);
}

/**
 * Ordem sugerida: vizinho mais proximo a partir da origem, depois 2-opt ate
 * nao melhorar. Pra <= 15 paradas por turno e instantaneo e tira os
 * cruzamentos que o vizinho-mais-proximo deixa.
 *
 * ponytail: heuristica, nao otimo. Se um dia houver 40 paradas por turno e
 * janelas de horario, isso vira um solver de verdade.
 */
export function sugerirOrdem(paradas: ParadaRota[], origem: { lat: number; lng: number } | null): SugestaoRota {
  const com = paradas.filter(temCoord);
  const sem = paradas.filter((p) => !temCoord(p));
  if (com.length === 0) return { ordem: sem.map((p) => p.id), metros: 0, semCoordenada: sem.length };

  // Vizinho mais proximo
  const restantes = [...com];
  const rota: ComCoord[] = [];
  let atual: { lat: number; lng: number } = origem ?? restantes[0]!;
  if (!origem) rota.push(restantes.shift()!);
  while (restantes.length) {
    let melhor = 0;
    let melhorD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < restantes.length; i++) {
      const d = haversineMetros(atual, restantes[i]!);
      if (d < melhorD) {
        melhorD = d;
        melhor = i;
      }
    }
    const [prox] = restantes.splice(melhor, 1);
    rota.push(prox!);
    atual = prox!;
  }

  // 2-opt: desfaz cruzamentos invertendo trechos enquanto encurtar.
  const custo = (r: ComCoord[]) => metrosDaOrdem(r, origem);
  let melhorou = true;
  let atualCusto = custo(rota);
  while (melhorou && rota.length > 3) {
    melhorou = false;
    for (let i = 0; i < rota.length - 1; i++) {
      for (let k = i + 1; k < rota.length; k++) {
        const nova = [...rota.slice(0, i), ...rota.slice(i, k + 1).reverse(), ...rota.slice(k + 1)];
        const c = custo(nova);
        if (c + 1 < atualCusto) {
          rota.splice(0, rota.length, ...nova);
          atualCusto = c;
          melhorou = true;
        }
      }
    }
  }

  return { ordem: [...rota.map((p) => p.id), ...sem.map((p) => p.id)], metros: atualCusto, semCoordenada: sem.length };
}
