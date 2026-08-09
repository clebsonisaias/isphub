import { mediana } from "./bi.js";

/**
 * PRODUTIVIDADE DA EQUIPE — as regras que decidem quanto vale o trabalho de
 * alguem.
 *
 * Este arquivo e diferente de todos os outros do pacote, e a diferenca nao e
 * tecnica: os numeros que saem daqui ficam ao lado do NOME de uma pessoa, num
 * ranking que outras pessoas vao ler. Um erro aqui nao produz um grafico
 * estranho — produz uma conversa injusta.
 *
 * Tres decisoes governam o arquivo, e as tres existem para conter isso:
 *
 * 1. **Contar OS e injusto, e por um motivo estrutural.** Quem passa o dia em
 *    instalacao fecha tres; quem passa o dia em retirada fecha dez. Um ranking
 *    por contagem nao mede esforco, mede que fila a pessoa pegou — e o unico
 *    jeito de subir nele e recusar o trabalho dificil. Por isso a unidade e o
 *    PONTO, e o ponto e ancorado no tempo.
 *
 * 2. **O peso de cada tipo sai da propria operacao, nunca de um numero que eu
 *    escolhi.** E a mediana de duracao daquele tipo NESTA empresa. Uma tabela
 *    de pesos escrita por quem programa e uma opiniao sobre o trabalho alheio
 *    disfarcada de constante; a mediana e uma medicao, e pode ser contestada
 *    com dados.
 *
 * 3. **Sem amostra, sem peso — e a tela precisa dizer isso.** Abaixo do minimo
 *    de OS medidas o tipo vale 1,0 e o resultado carrega `calibrado: false`.
 *    Inventar um peso com duas amostras seria dar aparencia de medicao a um
 *    palpite, exatamente onde ele custa mais caro.
 */

// ---------------------------------------------------------------------------
// O PESO DE UM TIPO DE OS
// ---------------------------------------------------------------------------

/**
 * Quantas OS daquele tipo precisam ter duracao medida para o peso valer.
 *
 * Cinco e baixo de proposito: o custo de errar aqui e um peso impreciso, e o
 * custo de exigir demais e a frota inteira empatada em 1,0 — que e a
 * contagem-por-OS que este modulo existe para evitar.
 */
export const MINIMO_AMOSTRAS_PESO = 5;

/** Teto do peso. Um tipo nao pode valer vinte vezes outro por causa de um caso. */
export const PESO_MAXIMO = 5;

/** Piso do peso. Nenhuma OS concluida vale menos que um quinto de uma. */
export const PESO_MINIMO = 0.2;

/**
 * O peso de um tipo de OS: quantas vezes ele demora mais que a MEDIANA GERAL.
 *
 * A referencia e a mediana de TODAS as OS medidas, e nao a media do tipo, por
 * duas razoes que se somam: mediana ignora a instalacao que levou seis horas
 * porque o cliente nao estava em casa, e a razao contra a mediana geral torna o
 * numero legivel — 2,0 quer dizer "leva o dobro do tipico".
 *
 * `null` quando nao da pra afirmar: sem amostra do tipo, sem mediana geral, ou
 * mediana geral zerada. Nunca 1,0 de consolo — quem chama distingue "vale o
 * tipico" de "nao sabemos", e a tela mostra a diferenca.
 */
export function pesoDoTipo(
  duracoesDoTipoMin: (number | null)[],
  medianaGeralMin: number | null,
  minimoAmostras = MINIMO_AMOSTRAS_PESO,
): number | null {
  if (medianaGeralMin === null || medianaGeralMin <= 0) return null;
  const doTipo = mediana(duracoesDoTipoMin, minimoAmostras);
  if (doTipo === null || doTipo <= 0) return null;
  return Math.min(PESO_MAXIMO, Math.max(PESO_MINIMO, doTipo / medianaGeralMin));
}

/**
 * Quanto tempo a OS levou, em minutos — do primeiro passo do tecnico ao
 * fechamento.
 *
 * Do "a caminho" e nao da ABERTURA: entre abrir e despachar pode haver dias de
 * fila, e fila nao e trabalho de tecnico. Medir dali puniria quem pega a OS
 * mais antiga, que e exatamente quem se quer premiar.
 *
 * `null` quando falta uma das pontas, quando o fim vem antes do inicio (relogio
 * de celular pode voltar) ou quando o resultado passa do teto de sanidade —
 * uma OS "de 18 horas" e quase sempre alguem que esqueceu de fechar, e deixa-la
 * entrar arrasta a mediana do tipo inteiro.
 */
export const DURACAO_MAXIMA_PLAUSIVEL_MIN = 12 * 60;

export function duracaoOsMin(inicioEm: Date | null, fimEm: Date | null): number | null {
  if (inicioEm === null || fimEm === null) return null;
  const min = (fimEm.getTime() - inicioEm.getTime()) / 60_000;
  if (!Number.isFinite(min) || min <= 0 || min > DURACAO_MAXIMA_PLAUSIVEL_MIN) return null;
  return min;
}

// ---------------------------------------------------------------------------
// A PONTUACAO
// ---------------------------------------------------------------------------

/**
 * O que um tecnico fez no periodo — a entrada da pontuacao.
 *
 * Nao ha campo "pontos" aqui: pontos sao DERIVADOS, e quem os deriva e a funcao
 * abaixo, com a decomposicao junto. Guardar o total sem as parcelas e o que
 * transforma um numero discutivel num numero indiscutivel.
 */
export interface ConcluidaDoTecnico {
  tipoOsId: string | null;
  /** Peso do tipo no periodo. `null` = tipo sem amostra suficiente. */
  peso: number | null;
  /** Fechou pelo app (com autor) ou apareceu fechada vinda do SGP. */
  peloApp: boolean;
}

export interface Pontuacao {
  /** Quantas OS, cruas. E o numero que todo mundo procura primeiro. */
  concluidas: number;
  /** A soma dos pesos — a pontuacao. Uma casa decimal basta. */
  pontos: number;
  /**
   * Quantas entraram valendo 1,0 por falta de amostra do tipo. Enquanto isto
   * for grande, a pontuacao e quase uma contagem — e a tela tem de dizer.
   */
  semPeso: number;
  /** Falso enquanto QUALQUER parcela entrou sem peso medido. */
  calibrado: boolean;
}

export function pontuar(concluidas: ConcluidaDoTecnico[]): Pontuacao {
  let pontos = 0;
  let semPeso = 0;
  for (const c of concluidas) {
    if (c.peso === null) {
      semPeso += 1;
      // 1,0 e o fallback EXPLICITO, e vem acompanhado de `semPeso`/`calibrado`:
      // a alternativa seria descartar a OS, que puniria o tecnico por uma
      // lacuna de dado que nao e dele.
      pontos += 1;
    } else {
      pontos += c.peso;
    }
  }
  return {
    concluidas: concluidas.length,
    pontos: Math.round(pontos * 10) / 10,
    semPeso,
    calibrado: semPeso === 0 && concluidas.length > 0,
  };
}

// ---------------------------------------------------------------------------
// COMO O TRABALHO ACONTECEU
// ---------------------------------------------------------------------------

/**
 * Estava alguem junto no carro quando a OS fechou?
 *
 * Uniao, e nao booleano, porque o caso dominante e o TERCEIRO: a maior parte da
 * frota nao tem ocupacao declarada, e "sem declaracao" nao e "estava sozinho".
 * Um booleano forcaria a tela a escolher um dos dois lados e a errar em massa.
 */
export type Acompanhamento =
  | { tipo: "sem_declaracao" }
  | { tipo: "sozinho" }
  | { tipo: "acompanhado"; colegas: number };

/**
 * O fechamento caiu dentro de um expediente registrado?
 *
 * Tambem uniao: `nao_registrou` (nunca abriu jornada naquele dia) e coisa
 * diferente de `fora` (abriu, e fechou a OS depois de encerrar). O primeiro e
 * falta de habito com o app; o segundo e hora extra ou esquecimento de fechar o
 * ponto. Colapsar os dois em "fora da jornada" acusaria todo mundo do mesmo.
 */
export type Expediente = { tipo: "dentro" } | { tipo: "fora" } | { tipo: "nao_registrou" };

export function classificarExpediente(
  fechadoEm: Date,
  jornadas: { inicioEm: Date; fimEm: Date | null }[],
): Expediente {
  if (jornadas.length === 0) return { tipo: "nao_registrou" };
  // Semiaberto `[inicio, fim)`, como todo intervalo do projeto: numa troca de
  // turno as 13h em ponto, fechado dos dois lados poria a pessoa em duas.
  const dentro = jornadas.some(
    (j) => fechadoEm >= j.inicioEm && (j.fimEm === null || fechadoEm < j.fimEm),
  );
  return dentro ? { tipo: "dentro" } : { tipo: "fora" };
}

export const ACOMPANHAMENTO_ROTULO: Record<Acompanhamento["tipo"], string> = {
  sem_declaracao: "sem viatura declarada",
  sozinho: "sozinho",
  acompanhado: "com colega",
};

export const EXPEDIENTE_ROTULO: Record<Expediente["tipo"], string> = {
  dentro: "dentro da jornada",
  fora: "fora da jornada",
  nao_registrou: "sem jornada registrada",
};
