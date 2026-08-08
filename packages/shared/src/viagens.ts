import { haversineMetros, type Ponto } from "./geodesia.js";

/**
 * VIAGEM — de ignicao ligada a ignicao desligada.
 *
 * Por que ignicao e nao velocidade: `segmentarParadas` (em `geodesia.ts`)
 * infere parada por VELOCIDADE, porque foi escrita quando a ignicao ainda era
 * jogada fora na coleta. Velocidade e o substituto de quem nao tem ignicao — ela
 * nao distingue "chegou no cliente e desligou o carro" de "parou no semaforo".
 *
 * Com `ACC` no banco, a pergunta tem resposta exata: o motorista girou a chave.
 * As duas funcoes continuam existindo porque respondem coisas diferentes —
 * "quantas viagens fez" (esta) e "onde ficou parado dentro de uma viagem"
 * (aquela).
 *
 * Puro de proposito: a serie de um dia inteiro cabe na memoria (1.200 pontos), e
 * uma funcao pura pode ser testada com a tabela-verdade toda sem banco.
 */

export interface PontoViagem extends Ponto {
  em: Date;
  /**
   * `null` = o aparelho nao contou. NAO e "desligada" — ver `Ignicao` em
   * `sensores.ts`. Ponto sem ignicao conhecida nao abre nem fecha viagem.
   */
  ignicao: boolean | null;
  velocidadeKmh: number | null;
}

export interface Viagem {
  inicioEm: Date;
  /** `null` = ainda em curso. O carro pode estar rodando agora. */
  fimEm: Date | null;
  latInicio: number;
  lngInicio: number;
  latFim: number;
  lngFim: number;
  distanciaMetros: number;
  velocidadeMaxKmh: number | null;
  /** Motor ligado com o carro imovel. Combustivel queimado a toa. */
  paradoComMotorLigadoSeg: number;
  pontos: number;
}

export interface OpcoesViagem {
  /** Abaixo disto o carro conta como imovel. 3 km/h absorve o jitter do GPS. */
  velocidadeParadoKmh?: number;
  /**
   * Buraco na serie maior que isto encerra a viagem no ultimo ponto conhecido.
   *
   * Sem este corte, um rastreador que ficou offline as 10h e voltou as 16h
   * produziria uma viagem de seis horas e uma reta atravessando a cidade — e o
   * relatorio de km diria que o carro rodou o que nunca rodou. Melhor duas
   * viagens e um vazio honesto entre elas.
   */
  intervaloMaximoMinutos?: number;
}

const PADRAO = { velocidadeParadoKmh: 3, intervaloMaximoMinutos: 30 };

interface Acumulador {
  inicio: PontoViagem;
  ultimo: PontoViagem;
  distancia: number;
  velMax: number | null;
  paradoSeg: number;
  pontos: number;
}

function fechar(acc: Acumulador, fimEm: Date | null): Viagem {
  return {
    inicioEm: acc.inicio.em,
    fimEm,
    latInicio: acc.inicio.lat,
    lngInicio: acc.inicio.lng,
    latFim: acc.ultimo.lat,
    lngFim: acc.ultimo.lng,
    distanciaMetros: Math.round(acc.distancia),
    velocidadeMaxKmh: acc.velMax,
    paradoComMotorLigadoSeg: Math.round(acc.paradoSeg),
    pontos: acc.pontos,
  };
}

/**
 * Divide a serie do dia em viagens.
 *
 * A serie precisa vir ORDENADA por tempo — e o que `trilha()` ja devolve.
 * Ordenar aqui dentro esconderia o erro de quem passou fora de ordem.
 */
export function segmentarViagens(pontos: PontoViagem[], opcoes: OpcoesViagem = {}): Viagem[] {
  const paradoKmh = opcoes.velocidadeParadoKmh ?? PADRAO.velocidadeParadoKmh;
  const gapMs = (opcoes.intervaloMaximoMinutos ?? PADRAO.intervaloMaximoMinutos) * 60_000;

  const viagens: Viagem[] = [];
  let acc: Acumulador | null = null;

  for (const p of pontos) {
    if (acc) {
      const deltaMs = p.em.getTime() - acc.ultimo.em.getTime();
      if (deltaMs > gapMs) {
        viagens.push(fechar(acc, acc.ultimo.em));
        acc = null;
      }
    }

    if (p.ignicao === true) {
      if (!acc) {
        acc = { inicio: p, ultimo: p, distancia: 0, velMax: p.velocidadeKmh, paradoSeg: 0, pontos: 1 };
        continue;
      }
      const deltaSeg = (p.em.getTime() - acc.ultimo.em.getTime()) / 1000;
      acc.distancia += haversineMetros(acc.ultimo, p);
      /*
       * Parado com motor ligado: o intervalo INTEIRO entre dois pontos lentos
       * conta. Contar so o instante do ponto daria sempre zero — a amostragem e
       * discreta, o desperdicio e continuo.
       */
      const vAtual = p.velocidadeKmh ?? 0;
      const vAnterior = acc.ultimo.velocidadeKmh ?? 0;
      if (vAtual <= paradoKmh && vAnterior <= paradoKmh) acc.paradoSeg += deltaSeg;
      if (p.velocidadeKmh != null && (acc.velMax == null || p.velocidadeKmh > acc.velMax)) {
        acc.velMax = p.velocidadeKmh;
      }
      acc.ultimo = p;
      acc.pontos += 1;
      continue;
    }

    if (p.ignicao === false && acc) {
      /*
       * O ponto de ignicao desligada E o fim da viagem: e onde o carro parou de
       * verdade. Fechar no ponto ANTERIOR perderia o ultimo trecho — que
       * costuma ser exatamente a chegada no cliente.
       */
      acc.distancia += haversineMetros(acc.ultimo, p);
      acc.ultimo = p;
      acc.pontos += 1;
      viagens.push(fechar(acc, p.em));
      acc = null;
      continue;
    }

    // `ignicao === null` dentro de uma viagem: o ponto entra na trilha (a
    // posicao e valida), mas nao decide nada sobre abrir ou fechar.
    if (acc && p.ignicao === null) {
      acc.distancia += haversineMetros(acc.ultimo, p);
      if (p.velocidadeKmh != null && (acc.velMax == null || p.velocidadeKmh > acc.velMax)) {
        acc.velMax = p.velocidadeKmh;
      }
      acc.ultimo = p;
      acc.pontos += 1;
    }
  }

  // Viagem ainda aberta fica com `fimEm: null` — e o carro que esta rodando
  // agora. Carimbar o ultimo ponto como fim mentiria dizendo que ja chegou.
  if (acc) viagens.push(fechar(acc, null));
  return viagens;
}
