import { haversineMetros, type Ponto } from "./geodesia.js";

/**
 * A viatura esteve no endereco? Duas perguntas, duas funcoes puras:
 * - check-in: ESTE ponto (parado) esta perto do destino da OS a caminho?
 * - auditoria: ALGUMA posicao da janela chegou perto do endereco da OS concluida?
 */

/** Velocidade a partir da qual o carro conta como parado (igual a `segmentarParadas`). */
export const VELOCIDADE_PARADO_KMH = 3;

export function pontoParado(p: { velocidadeKmh: number | null; ignicao?: "ligada" | "desligada" | "anomalia" | null }): boolean {
  if (p.ignicao === "desligada") return true;
  return p.velocidadeKmh != null && p.velocidadeKmh <= VELOCIDADE_PARADO_KMH;
}

/** Decide o check-in automatico de uma OS "a caminho". */
export function deveFazerCheckin(args: {
  ponto: { lat: number; lng: number; velocidadeKmh: number | null; ignicao?: "ligada" | "desligada" | "anomalia" | null };
  destino: Ponto | null;
  raioMetros: number;
}): { sim: boolean; distanciaMetros: number | null } {
  if (args.raioMetros <= 0 || !args.destino) return { sim: false, distanciaMetros: null };
  if (!pontoParado(args.ponto)) return { sim: false, distanciaMetros: null };
  const d = Math.round(haversineMetros(args.ponto, args.destino));
  return { sim: d <= args.raioMetros, distanciaMetros: d };
}

export type VereditoPresenca = "presente" | "ausente" | "sem_dados";

/**
 * Veredito da auditoria. `sem_dados` quando nao ha posicoes ou endereco —
 * nunca vira alerta: ausencia de evidencia nao e evidencia de ausencia.
 */
export function vereditoPresenca(args: {
  posicoes: Ponto[];
  endereco: Ponto | null;
  raioMetros: number;
}): { veredito: VereditoPresenca; distanciaMinMetros: number | null } {
  if (!args.endereco || args.posicoes.length === 0) return { veredito: "sem_dados", distanciaMinMetros: null };
  let min = Number.POSITIVE_INFINITY;
  for (const p of args.posicoes) min = Math.min(min, haversineMetros(p, args.endereco));
  const d = Math.round(min);
  return { veredito: d <= args.raioMetros ? "presente" : "ausente", distanciaMinMetros: d };
}
