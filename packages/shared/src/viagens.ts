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

/**
 * O ACUMULADOR de uma viagem em curso — e, no banco, a propria linha `Viagem`
 * com `fimEm IS NULL`.
 *
 * Que ele seja identico a linha aberta nao e coincidencia, e a razao de existir:
 * a coleta recebe UM ponto por vez e nao tem a serie do dia na mao. Sem este
 * formato, "o que e uma viagem" teria de ser escrito duas vezes — uma em lote
 * (para relatorio) e outra incremental (para a coleta) — e as duas versoes
 * divergiriam no primeiro caso de borda.
 */
export interface ViagemAberta {
  inicioEm: Date;
  latInicio: number;
  lngInicio: number;
  /** O ULTIMO ponto visto. E o que permite acumular o proximo sem a serie. */
  ultimoEm: Date;
  ultimaLat: number;
  ultimaLng: number;
  ultimaVelocidadeKmh: number | null;
  distanciaMetros: number;
  velocidadeMaxKmh: number | null;
  paradoComMotorLigadoSeg: number;
  pontos: number;
}

/**
 * O efeito de UM ponto sobre o estado das viagens.
 *
 * Formato PLANO de proposito: uma uniao com `abrir | acumular | fechar |
 * fechar_e_abrir` obrigaria o chamador a um `switch` que esquece um caso. Aqui
 * todo ponto devolve a mesma forma, e cada campo responde uma pergunta:
 *
 *   `fechar`  — ha uma viagem para GRAVAR como encerrada agora?
 *   `aberta`  — qual e o estado da viagem em curso DEPOIS deste ponto?
 *   `nova`    — `aberta` e uma viagem que acabou de comecar (INSERT) ou a mesma
 *               de antes, mais um ponto (UPDATE)?
 */
export interface PassoViagem {
  fechar: Viagem | null;
  aberta: ViagemAberta | null;
  nova: boolean;
}

function abrir(p: PontoViagem): ViagemAberta {
  return {
    inicioEm: p.em,
    latInicio: p.lat,
    lngInicio: p.lng,
    ultimoEm: p.em,
    ultimaLat: p.lat,
    ultimaLng: p.lng,
    ultimaVelocidadeKmh: p.velocidadeKmh,
    distanciaMetros: 0,
    velocidadeMaxKmh: p.velocidadeKmh,
    paradoComMotorLigadoSeg: 0,
    pontos: 1,
  };
}

/** Encerra o acumulador. `fimEm` nulo = ainda em curso (so na leitura em lote). */
function encerrar(a: ViagemAberta, fimEm: Date | null): Viagem {
  return {
    inicioEm: a.inicioEm,
    fimEm,
    latInicio: a.latInicio,
    lngInicio: a.lngInicio,
    latFim: a.ultimaLat,
    lngFim: a.ultimaLng,
    distanciaMetros: Math.round(a.distanciaMetros),
    velocidadeMaxKmh: a.velocidadeMaxKmh,
    paradoComMotorLigadoSeg: Math.round(a.paradoComMotorLigadoSeg),
    pontos: a.pontos,
  };
}

function acumular(a: ViagemAberta, p: PontoViagem, paradoKmh: number): ViagemAberta {
  const deltaSeg = (p.em.getTime() - a.ultimoEm.getTime()) / 1000;
  /*
   * Parado com motor ligado: o intervalo INTEIRO entre dois pontos lentos
   * conta. Contar so o instante do ponto daria sempre zero — a amostragem e
   * discreta, o desperdicio e continuo.
   */
  const paradoAgora = (p.velocidadeKmh ?? 0) <= paradoKmh && (a.ultimaVelocidadeKmh ?? 0) <= paradoKmh;
  return {
    ...a,
    distanciaMetros: a.distanciaMetros + haversineMetros({ lat: a.ultimaLat, lng: a.ultimaLng }, p),
    velocidadeMaxKmh:
      p.velocidadeKmh != null && (a.velocidadeMaxKmh == null || p.velocidadeKmh > a.velocidadeMaxKmh)
        ? p.velocidadeKmh
        : a.velocidadeMaxKmh,
    paradoComMotorLigadoSeg: a.paradoComMotorLigadoSeg + (paradoAgora ? deltaSeg : 0),
    ultimoEm: p.em,
    ultimaLat: p.lat,
    ultimaLng: p.lng,
    ultimaVelocidadeKmh: p.velocidadeKmh,
    pontos: a.pontos + 1,
  };
}

/**
 * UM ponto, aplicado ao estado corrente. E a definicao unica de "viagem".
 *
 * `segmentarViagens` e um dobra desta funcao sobre a serie; a coleta a chama uma
 * vez por ponto novo. As duas nao podem discordar porque sao a mesma regra.
 */
export function avancarViagem(
  aberta: ViagemAberta | null,
  p: PontoViagem,
  opcoes: OpcoesViagem = {},
): PassoViagem {
  const paradoKmh = opcoes.velocidadeParadoKmh ?? PADRAO.velocidadeParadoKmh;
  const gapMs = (opcoes.intervaloMaximoMinutos ?? PADRAO.intervaloMaximoMinutos) * 60_000;

  /*
   * Buraco longo na serie: a viagem antiga morre no ULTIMO ponto conhecido, e
   * este ponto e tratado como se nao houvesse nada aberto. Sem o corte, um
   * rastreador que sumiu as 10h e voltou as 16h produziria uma viagem de seis
   * horas e uma reta atravessando a cidade.
   */
  if (aberta && p.em.getTime() - aberta.ultimoEm.getTime() > gapMs) {
    const fechada = encerrar(aberta, aberta.ultimoEm);
    return p.ignicao === true
      ? { fechar: fechada, aberta: abrir(p), nova: true }
      : { fechar: fechada, aberta: null, nova: false };
  }

  if (!aberta) {
    // So a ignicao LIGADA abre viagem. `false` sem nada aberto nao cria viagem
    // do nada; `null` (o aparelho nao contou) muito menos.
    return p.ignicao === true ? { fechar: null, aberta: abrir(p), nova: true } : { fechar: null, aberta: null, nova: false };
  }

  if (p.ignicao === false) {
    /*
     * O ponto de ignicao desligada E o fim da viagem: e onde o carro parou de
     * verdade. Fechar no ponto ANTERIOR perderia o ultimo trecho — que costuma
     * ser exatamente a chegada no cliente.
     */
    return { fechar: encerrar(acumular(aberta, p, paradoKmh), p.em), aberta: null, nova: false };
  }

  // `true` acumula; `null` tambem — a posicao e valida, so nao decide nada
  // sobre abrir ou fechar.
  return { fechar: null, aberta: acumular(aberta, p, paradoKmh), nova: false };
}

/**
 * Divide a serie do dia em viagens — uma DOBRA de `avancarViagem`.
 *
 * A serie precisa vir ORDENADA por tempo — e o que `trilha()` ja devolve.
 * Ordenar aqui dentro esconderia o erro de quem passou fora de ordem.
 */
export function segmentarViagens(pontos: PontoViagem[], opcoes: OpcoesViagem = {}): Viagem[] {
  const viagens: Viagem[] = [];
  let aberta: ViagemAberta | null = null;

  for (const p of pontos) {
    const passo = avancarViagem(aberta, p, opcoes);
    if (passo.fechar) viagens.push(passo.fechar);
    aberta = passo.aberta;
  }

  // Viagem ainda aberta fica com `fimEm: null` — e o carro que esta rodando
  // agora. Carimbar o ultimo ponto como fim mentiria dizendo que ja chegou.
  if (aberta) viagens.push(encerrar(aberta, null));
  return viagens;
}
