/**
 * BI DA FROTA — a aritmética que pode estar errada em silêncio.
 *
 * Mora aqui, pura e testável sem banco, pela mesma razão que `montarLinhasDre`
 * mora fora do SQL: uma conta errada num painel de custo nao levanta excecao —
 * ela fecha, e mente. E o numero que sai daqui vira decisao sobre o dinheiro e
 * sobre a reputacao de um motorista.
 *
 * Duas disciplinas atravessam o arquivo inteiro:
 *
 * 1. **`null` e uma resposta.** Toda funcao devolve `null` quando nao da pra
 *    afirmar, e nunca um zero de consolo. E a mesma regra que
 *    `consumoPorAbastecimento` ja aplica ("um numero inventado num painel de
 *    custo vira decisao errada") e a mesma dos sensores do rastreador.
 *
 * 2. **Dinheiro em centavos inteiros.** Nenhum `Number` toca valor monetario,
 *    como manda `relatorioFinanceiroService`.
 */

// ---------------------------------------------------------------------------
// O DIA
// ---------------------------------------------------------------------------

/** -03:00 fixo — o Brasil aboliu horario de verao em 2019. Mesma constante de `dia.ts`. */
const OFFSET_BR_MIN = -180;

/**
 * A chave do dia CIVIL brasileiro a que um instante pertence — "2026-08-08".
 *
 * `dia.ts` ja responde "onde comeca e termina o dia de HOJE"; uma serie precisa
 * da pergunta inversa, para cada um de noventa dias. Sem isto, agregar por dia
 * usa o dia UTC, e o servidor roda sem `TZ`: tudo que aconteceu entre 21h e a
 * meia-noite em Natal cai no dia seguinte. Num BI isso nao aparece como erro —
 * aparece como um pico de quilometragem na madrugada.
 */
export function chaveDiaBrasileiro(instante: Date): string {
  const local = new Date(instante.getTime() + OFFSET_BR_MIN * 60_000);
  const ano = local.getUTCFullYear();
  const mes = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(local.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/**
 * O dia de uma DATA CIVIL — um campo que ja e "AAAA-MM-DD" e virou `Date`.
 *
 * Par obrigatorio de `chaveDiaBrasileiro`, e a distincao nao e preciosismo:
 * `Abastecimento.data` chega como string do formulario e o Prisma a grava a
 * meia-noite UTC. Convertida "para o fuso brasileiro", ela vira 21h do dia
 * ANTERIOR — e o abastecimento de terca passa a nao ter viagem nenhuma, porque
 * as viagens continuam na terca. Foi assim que dez falsos positivos entraram no
 * bloco de auditoria.
 *
 * Regra: `chaveDiaBrasileiro` para INSTANTES (quando algo aconteceu);
 * `diaDeDataCivil` para DATAS (que dia alguem escreveu no formulario).
 */
export function diaDeDataCivil(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * A hora do dia (0–23) no fuso brasileiro.
 *
 * Alimenta o perfil "a que horas a frota sai". Em UTC, o pico das 7h da manha
 * apareceria as 10h.
 */
export function horaBrasileira(instante: Date): number {
  return new Date(instante.getTime() + OFFSET_BR_MIN * 60_000).getUTCHours();
}

/**
 * Todas as chaves de dia entre duas datas, inclusive as duas pontas.
 *
 * Existe para o grafico ter os dias VAZIOS. Uma serie montada so com os dias que
 * tiveram viagem esconde exatamente o que interessa — o dia em que o carro nao
 * saiu vira um buraco no eixo, e o olho le como "nao medimos", quando o certo e
 * "nao rodou".
 *
 * Teto de 400 dias porque a entrada vem do usuario: um intervalo digitado errado
 * nao pode virar laco infinito.
 */
export function diasDoIntervalo(de: Date, ate: Date, maximo = 400): string[] {
  const chaves: string[] = [];
  let cursor = de.getTime();
  const limite = ate.getTime();
  while (cursor <= limite && chaves.length < maximo) {
    chaves.push(chaveDiaBrasileiro(new Date(cursor)));
    cursor += 24 * 60 * 60_000;
  }
  return chaves;
}

// ---------------------------------------------------------------------------
// ODOMETRO x GPS
// ---------------------------------------------------------------------------

/**
 * A razao entre o que o odometro andou e o que o GPS viu.
 *
 * **O GPS SUBESTIMA, sempre, e por construcao.** A coleta amostra uma posicao
 * por minuto e a distancia da viagem e a soma de retas entre pontos
 * consecutivos: a 60 km/h sao mil metros entre amostras, e a reta corta a curva.
 * Uma razao de 1,10 nao e suspeita — e o normal.
 *
 * Por isso esta funcao NAO julga. Ela devolve o numero; quem decide o que e
 * anomalo e `desvioDaMediana`, comparando cada veiculo com o comportamento da
 * propria frota.
 *
 * `null` quando qualquer lado falta ou e zero: dividir por zero daria Infinity,
 * e Infinity num painel vira "999.999" sem que ninguem entenda de onde veio.
 */
export function razaoOdometroGps(kmOdometro: number | null, metrosGps: number | null): number | null {
  if (kmOdometro === null || metrosGps === null) return null;
  if (!Number.isFinite(kmOdometro) || !Number.isFinite(metrosGps)) return null;
  const kmGps = metrosGps / 1000;
  if (kmOdometro <= 0 || kmGps <= 0) return null;
  return kmOdometro / kmGps;
}

/** Mediana de uma amostra, `null` abaixo do minimo. Sem float acumulado. */
export function mediana(valores: (number | null)[], minimoAmostras = 3): number | null {
  const validas = valores.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (validas.length < minimoAmostras) return null;
  const meio = Math.floor(validas.length / 2);
  return validas.length % 2 === 0 ? (validas[meio - 1]! + validas[meio]!) / 2 : validas[meio]!;
}

/**
 * COBERTURA: quanto do periodo o rastreador de fato observou.
 *
 * Esta e a metrica PRIMARIA da auditoria, e nao a divergencia — e a inversao
 * mais importante deste modulo.
 *
 * A razao odometro/GPS parece medir o motorista, mas o termo dominante dela e
 * outro: quantos minutos de direcao o aparelho enxergou. Tres coisas fazem o
 * GPS ver menos do que aconteceu, e nenhuma delas e culpa de quem dirige:
 *
 *   - a reta entre duas amostras de um minuto CORTA a curva;
 *   - um buraco de ate 30 minutos na serie nao fecha a viagem — vira uma corda
 *     reta atravessando meia hora de trajeto;
 *   - durante um apagao do aparelho o `ACC` some, a ignicao vira desconhecida e
 *     a viagem **nem existe**.
 *
 * Publicar divergencia sem cobertura ao lado e publicar saude de hardware com
 * rotulo de suspeita sobre uma pessoa.
 */
export function coberturaPct(minutosCegos: number, minutosDoPeriodo: number): number | null {
  if (!Number.isFinite(minutosCegos) || !Number.isFinite(minutosDoPeriodo) || minutosDoPeriodo <= 0) return null;
  const cega = Math.min(Math.max(minutosCegos, 0), minutosDoPeriodo);
  return Math.round((1 - cega / minutosDoPeriodo) * 100);
}

/** Abaixo disto a divergencia nao e comparavel — o buraco explica qualquer coisa. */
export const COBERTURA_MINIMA_PCT = 95;

/** Quantos intervalos anteriores bastam para o veiculo ser base de si mesmo. */
export const MINIMO_HISTORICO = 3;

/**
 * O quanto a divergencia precisa fugir da propria historia para valer um olhar.
 *
 * 25% e generoso de proposito. O primeiro alerta falso de um painel de auditoria
 * custa mais caro que dez omissoes: depois dele, ninguem volta a olhar.
 */
export const DESVIO_NOTAVEL_PCT = 25;

/**
 * O veredito de uma divergencia — uma UNIAO, nunca um numero solto.
 *
 * O tipo e a protecao, e nao o texto da tela: se esta funcao devolvesse
 * `number`, alguem renderizaria `number`, e um numero cru ao lado de uma placa
 * le como acusacao. Aqui a tela e obrigada a tratar `sem_base` — que e o caso
 * mais comum — antes de conseguir mostrar qualquer coisa.
 *
 * "revisar" e nao "irregular": o que o painel sabe e que o carro mudou em
 * relacao a ele mesmo. O porque pode ser furto, pode ser odometro digitado
 * errado, pode ser um rastreador comecando a falhar.
 */
export type VereditoDivergencia =
  | { tipo: "sem_base"; motivo: "cobertura_baixa" | "sem_historico" | "sem_medida" }
  | { tipo: "dentro"; razao: number; base: number }
  | { tipo: "revisar"; razao: number; base: number; desvioPct: number };

/**
 * Compara o veiculo com A PROPRIA HISTORIA, e nao com a mediana da frota.
 *
 * A mediana da frota parece a base natural, e nao e: o vies corda-versus-arco
 * depende do PERFIL DE ROTA do veiculo. Um carro que so roda no centro diverge
 * legitimamente mais que um de rodovia. Calibrar pela frota transformaria
 * "este carro roda no centro" em "este carro esta fora do padrao".
 *
 * A historia do proprio veiculo controla o perfil de rota automaticamente — e,
 * de quebra, funciona com UM veiculo rastreado, que e a situacao de hoje. Uma
 * base de frota estavel o bastante para acusar alguem precisaria de mais de uma
 * dezena de carros rastreados; a propria historia precisa de tres intervalos.
 */
export function avaliarDivergencia(args: {
  razao: number | null;
  cobertura: number | null;
  historico: (number | null)[];
}): VereditoDivergencia {
  /*
   * A cobertura e testada ANTES da razao, e a ordem nao e estilo: quando o
   * aparelho fica cego, o GPS soma zero e a razao vem `null` — ou seja, a falta
   * de medida E a cegueira. Testar `razao` primeiro devolveria "sem medida",
   * que manda o leitor procurar um odometro que ele ja tem, em vez de mandar
   * consertar o rastreador, que e o que resolve.
   */
  if (args.cobertura === null || args.cobertura < COBERTURA_MINIMA_PCT) {
    return { tipo: "sem_base", motivo: "cobertura_baixa" };
  }
  if (args.razao === null) return { tipo: "sem_base", motivo: "sem_medida" };
  const base = mediana(args.historico, MINIMO_HISTORICO);
  if (base === null || base <= 0) return { tipo: "sem_base", motivo: "sem_historico" };

  const desvioPct = (args.razao / base - 1) * 100;
  return Math.abs(desvioPct) >= DESVIO_NOTAVEL_PCT
    ? { tipo: "revisar", razao: args.razao, base, desvioPct }
    : { tipo: "dentro", razao: args.razao, base };
}

/** O texto que acompanha cada veredito — a explicacao mora junto do rotulo. */
export const VEREDITO_ROTULO: Record<VereditoDivergencia["tipo"], string> = {
  sem_base: "sem base para comparar",
  dentro: "dentro do próprio histórico",
  revisar: "revisar",
};

export const SEM_BASE_MOTIVO_ROTULO: Record<
  Extract<VereditoDivergencia, { tipo: "sem_base" }>["motivo"],
  string
> = {
  cobertura_baixa: "o rastreador ficou cego parte do período",
  sem_historico: "poucos períodos anteriores para comparar",
  sem_medida: "sem odômetro ou sem GPS no período",
};

// ---------------------------------------------------------------------------
// COMBUSTIVEL QUEIMADO A TOA
// ---------------------------------------------------------------------------

/**
 * Consumo em marcha lenta, em litros por hora.
 *
 * Numero de REFERENCIA para carro de passeio 1.0–1.6, nao uma medicao deste
 * carro. Fica numa constante exportada, e num lugar so, justamente para ser
 * facil de contestar e de ajustar — e para ninguem espalhar 0,8 pelo codigo.
 */
export const CONSUMO_MARCHA_LENTA_L_HORA = 0.8;

/**
 * Estimativa de litros queimados com o carro parado e o motor ligado.
 *
 * **E uma ESTIMATIVA**, e a tela precisa dizer isso ao lado do numero. O tempo e
 * medido (vem de `Viagem.paradoComMotorLigadoSeg`); os litros sao inferidos de
 * uma taxa de referencia. Apresentar os dois com a mesma confianca seria dar ao
 * palpite o peso do fato.
 */
export function litrosOciosos(segundos: number | null, litrosPorHora = CONSUMO_MARCHA_LENTA_L_HORA): number | null {
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) return null;
  return (segundos / 3600) * litrosPorHora;
}

// ---------------------------------------------------------------------------
// CUSTO
// ---------------------------------------------------------------------------

/**
 * Custo por quilometro, em CENTAVOS por km, como string com duas casas.
 *
 * Entra centavos inteiros e sai string — o dinheiro nao vira `number` em momento
 * nenhum, pela mesma razao que o resto do modulo financeiro mantem essa porta
 * fechada: basta um `Number()` copiado daqui para um lugar onde ele importa.
 *
 * `null` sem quilometragem: um custo por km sem km e uma divisao por zero
 * disfarcada de metrica.
 */
export function custoPorKm(centavos: number | null, km: number | null): string | null {
  if (centavos === null || km === null) return null;
  if (!Number.isFinite(centavos) || !Number.isFinite(km) || km <= 0) return null;
  // Centavos por km, arredondado ao centavo, e so entao formatado em reais.
  const centavosPorKm = Math.round(centavos / km);
  return (centavosPorKm / 100).toFixed(2);
}

/** "R$ 1,82/km" — o formato que a tela mostra. `null` vira travessao. */
export function formatarCustoPorKm(valor: string | null): string {
  return valor === null ? "—" : `R$ ${valor.replace(".", ",")}/km`;
}

/**
 * Preco medio do litro no periodo, em centavos.
 *
 * Soma de valores dividida pela soma de litros — e NAO a media dos precos
 * unitarios. A diferenca aparece quando um abastecimento de 5 litros num posto
 * caro pesa igual a um de 50 litros num barato: a media simples mentiria sobre
 * quanto a frota efetivamente pagou.
 */
export function precoMedioLitro(centavosTotal: number | null, litrosTotal: number | null): string | null {
  if (centavosTotal === null || litrosTotal === null) return null;
  if (!Number.isFinite(centavosTotal) || !Number.isFinite(litrosTotal) || litrosTotal <= 0) return null;
  return (Math.round(centavosTotal / litrosTotal) / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// ESTADO DO DADO
// ---------------------------------------------------------------------------

/**
 * Por que uma metrica esta vazia — a diferenca entre "nao rodou" e "nao sabemos".
 *
 * Existe porque a frota tem hoje um rastreador e dezenas de veiculos: a tela vai
 * ficar cheia de celulas sem numero, e cada uma precisa dizer QUAL das duas
 * coisas ela e. Uma celula vazia lida como zero e a forma mais barata de um
 * painel mentir.
 */
export type MotivoSemDado = "sem_rastreador" | "sem_odometro" | "sem_abastecimento" | "sem_movimento";

export const MOTIVO_SEM_DADO_ROTULO: Record<MotivoSemDado, string> = {
  sem_rastreador: "sem rastreador",
  sem_odometro: "sem odômetro no período",
  sem_abastecimento: "sem abastecimento no período",
  sem_movimento: "não rodou",
};

// ---------------------------------------------------------------------------
// O CONTRATO DOS TRES ENDPOINTS
//
// Mora aqui, e nao no service, porque a tela consome exatamente estes tipos: em
// `apps/api` o web nao alcanca, e a alternativa seria redigitar a forma no
// cliente — que e como um campo some de um lado e continua sendo lido do outro.
// ---------------------------------------------------------------------------

/**
 * O que o rastreador sabe deste veiculo no periodo — uma UNIAO, nao campos
 * opcionais.
 *
 * E a protecao mais importante da tela. Com campos opcionais, `kmGps ?? 0`
 * apareceria em algum lugar no primeiro dia, e a metade da frota que nao tem
 * rastreador passaria a "nao rodar" em vez de "nao sabemos".
 */
export type Rastreamento =
  | { tipo: "sem_rastreador" }
  | { tipo: "sem_movimento"; coberturaPct: number | null }
  | {
      tipo: "medido";
      kmGps: number;
      viagens: number;
      /** Viagens cuja distancia nao foi calculada — sem isto o total mente. */
      viagensSemDistancia: number;
      ociosoSeg: number;
      velocidadeMaxKmh: number | null;
      coberturaPct: number | null;
    };

export interface LinhaVeiculo {
  veiculoId: string;
  placa: string;
  modelo: string;
  provedorNome: string | null;
  /**
   * SO isto, e nao o estado de movimento: este endpoint nao consulta `Viagem`, e
   * afirmar "sem movimento" sem ter olhado seria inventar. Quem responde
   * movimento e cobertura e `/frota/bi/uso`.
   */
  temRastreador: boolean;
  /** Delta do odometro entre o primeiro e o ultimo abastecimento do periodo. */
  kmOdometro: number | null;
  abastecimentos: number;
  litros: string | null;
  /** Combustivel + qualquer lancamento com `veiculoId`. Sempre string. */
  gastoTotal: string;
  gastoCombustivel: string;
  /** R$/km sobre o odometro — `null` sem odometro no periodo. */
  custoPorKm: string | null;
  /** km/l pelo metodo tanque-cheio. `null` com menos de dois cheios. */
  kmPorLitro: number | null;
}

export interface BiCusto {
  de: string;
  ate: string;
  resumo: {
    veiculos: number;
    comRastreador: number;
    gastoTotal: string;
    gastoCombustivel: string;
    litros: string;
    precoMedioLitro: string | null;
  };
  veiculos: LinhaVeiculo[];
  porPosto: { posto: string; litros: string; gasto: string; precoMedio: string | null }[];
}

export interface BiUso {
  de: string;
  ate: string;
  resumo: { kmGps: number; viagens: number; ociosoSeg: number; veiculosSemUso: number };
  serie: { dia: string; kmGps: number; viagens: number }[];
  veiculos: { veiculoId: string; placa: string; rastreamento: Rastreamento }[];
  /** Excesso de velocidade por veiculo. `veiculoId` nulo entra em linha propria. */
  excessos: { veiculoId: string | null; placa: string | null; ocorrencias: number }[];
}

export interface BiAuditoria {
  de: string;
  ate: string;
  divergencias: {
    veiculoId: string;
    placa: string;
    veredito: VereditoDivergencia;
    kmOdometro: number | null;
    kmGps: number | null;
    coberturaPct: number | null;
  }[];
  /** Sinais que NAO dependem de GPS — valem para a frota inteira. */
  abastecimentoSemRodagem: { veiculoId: string; placa: string; data: string; litros: string }[];
  viagensSemOcupacao: { veiculoId: string; placa: string; viagens: number }[];
  rastreadoresMudos: {
    veiculoId: string | null;
    placa: string | null;
    desde: string | null;
    /**
     * POR QUE ele esta mudo — e a diferenca decide quem vai consertar o que.
     *
     * - `calado`: nem radio nem GPS. Aparelho sem energia, chip sem saldo,
     *   fusivel. O carro pode estar em qualquer lugar.
     * - `cego`: o radio FALA e o GPS nao. Garagem, laje, antena arrancada — e o
     *   caso perigoso, porque nenhum `ficou_offline` dispara (o sensor
     *   COMMUNICATION segue `UP`) e o mapa continua mostrando o carro na ultima
     *   coordenada, como se estivesse parado ali.
     * - `dormindo`: modo de economia LIGADO. O silencio e por desenho, nao
     *   defeito — mandar alguem olhar o carro por isto e desperdicio, e acusar
     *   o aparelho e injusto com ele.
     * - `nunca_reportou`: aparelho novo, ou vinculado ao veiculo errado.
     * - `indeterminado`: nao ha leitura do radio ainda (a coluna nasceu depois
     *   deste aparelho). NAO e "calado" — dizer "sem comunicacao" com base na
     *   ausencia de um campo seria afirmar exatamente o que nao se sabe, que e
     *   o erro que o resto deste modulo existe para evitar.
     *
     * Antes de o `lastCommunication` ser lido, os quatro eram a mesma linha.
     */
    motivo: "calado" | "cego" | "dormindo" | "nunca_reportou" | "indeterminado";
    /** Quando o RADIO falou pela ultima vez. `null` = nunca, ou ainda nao coletado. */
    comunicouEm: string | null;
  }[];
}
