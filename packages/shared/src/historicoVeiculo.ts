/**
 * O HISTORICO DO DIA de um veiculo: viagens, paradas e totais.
 *
 * Parada = o intervalo ENTRE duas viagens (ignicao desligada ate religar). O
 * lugar e onde a viagem anterior terminou. Nao ha tabela de paradas: elas sao
 * derivadas das viagens, que ja sao a verdade — guardar as duas permitiria que
 * discordassem.
 */

import { OFFSET_BR_MIN } from "./dia.js";

/** Intervalo minimo pra contar como parada. Abaixo disso e liga/desliga de manobra. */
export const PARADA_MINIMA_SEG = 3 * 60;

export interface ViagemDoDia {
  id: string;
  inicioEm: string;
  /** Nulo = em curso. */
  fimEm: string | null;
  latInicio: number;
  lngInicio: number;
  latFim: number;
  lngFim: number;
  distanciaMetros: number | null;
  velocidadeMaxKmh: number | null;
  paradoComMotorLigadoSeg: number | null;
  /** Quem dirigia; nulo quando ninguem estava declarado no carro. */
  motorista: string | null;
}

export interface ParadaDoDia {
  inicioEm: string;
  fimEm: string;
  duracaoSeg: number;
  lat: number;
  lng: number;
}

export interface TotaisDoDia {
  distanciaMetros: number;
  viagens: number;
  emMovimentoSeg: number;
  paradoComMotorLigadoSeg: number;
  velocidadeMaxKmh: number | null;
  /** Motoristas distintos do dia, na ordem em que apareceram. */
  motoristas: string[];
}

export interface HistoricoDoDia {
  /** "2026-11-06" — o dia no fuso de Brasilia. */
  dia: string;
  inicio: string;
  fim: string;
  agoraServidor: string;
  viagens: ViagemDoDia[];
  paradas: ParadaDoDia[];
  totais: TotaisDoDia;
}

/** Inicio e fim (exclusivo) de um dia "AAAA-MM-DD" no fuso de Brasilia. */
export function limitesDoDia(dia: string): { inicio: Date; fim: Date } {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  const inicio = new Date(Date.UTC(a, m - 1, d) - OFFSET_BR_MIN * 60_000);
  return { inicio, fim: new Date(inicio.getTime() + 24 * 60 * 60_000) };
}

/** O dia "AAAA-MM-DD" de um instante, no fuso de Brasilia. */
export function diaBrasileiroIso(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_BR_MIN * 60_000).toISOString().slice(0, 10);
}

/**
 * Paradas e totais a partir das viagens do dia.
 *
 * `agora` limita a viagem em curso: ela conta o tempo em movimento ate agora,
 * nao ate o fim do dia.
 */
export function resumirDia(
  viagensEmQualquerOrdem: ViagemDoDia[],
  agora: Date,
): { viagens: ViagemDoDia[]; paradas: ParadaDoDia[]; totais: TotaisDoDia } {
  const viagens = [...viagensEmQualquerOrdem].sort((a, b) => Date.parse(a.inicioEm) - Date.parse(b.inicioEm));

  const paradas: ParadaDoDia[] = [];
  for (let i = 0; i + 1 < viagens.length; i++) {
    const atual = viagens[i]!;
    const prox = viagens[i + 1]!;
    if (!atual.fimEm) continue; // em curso nao tem "depois"
    const duracaoSeg = Math.round((Date.parse(prox.inicioEm) - Date.parse(atual.fimEm)) / 1000);
    if (duracaoSeg < PARADA_MINIMA_SEG) continue;
    paradas.push({ inicioEm: atual.fimEm, fimEm: prox.inicioEm, duracaoSeg, lat: atual.latFim, lng: atual.lngFim });
  }

  const motoristas: string[] = [];
  let distanciaMetros = 0;
  let emMovimentoSeg = 0;
  let paradoComMotorLigadoSeg = 0;
  let velocidadeMaxKmh: number | null = null;
  for (const v of viagens) {
    distanciaMetros += v.distanciaMetros ?? 0;
    const fim = v.fimEm ? Date.parse(v.fimEm) : agora.getTime();
    emMovimentoSeg += Math.max(0, Math.round((fim - Date.parse(v.inicioEm)) / 1000));
    paradoComMotorLigadoSeg += v.paradoComMotorLigadoSeg ?? 0;
    if (v.velocidadeMaxKmh != null && (velocidadeMaxKmh == null || v.velocidadeMaxKmh > velocidadeMaxKmh)) {
      velocidadeMaxKmh = v.velocidadeMaxKmh;
    }
    if (v.motorista && !motoristas.includes(v.motorista)) motoristas.push(v.motorista);
  }

  return {
    viagens,
    paradas,
    totais: { distanciaMetros, viagens: viagens.length, emMovimentoSeg, paradoComMotorLigadoSeg, velocidadeMaxKmh, motoristas },
  };
}
