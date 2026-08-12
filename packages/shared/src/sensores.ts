/**
 * Sensores do rastreador — leitura generica, dicionario do fornecedor, e a
 * derivacao de EVENTOS a partir de duas fotografias consecutivas.
 *
 * A decisao que sustenta este arquivo: **sensor nao vira coluna**. O fornecedor
 * publica hoje 14 (`GET /status-descriptions`) e pode publicar o 15o amanha.
 * Fixar `ignicao`, `bateria`, `temperatura`... seria eu apostando em quais
 * importam — e a aposta erra no dia em que chega um aparelho com sensor de
 * porta ou de carga.
 *
 * Entao: o mapa cru inteiro e guardado, e o DICIONARIO DO FORNECEDOR manda no
 * rotulo e na severidade. Um rastreador com temperatura ganha lugar na tela sem
 * uma linha de codigo nova.
 *
 * Tudo aqui e puro, e por isso mora em `shared`: web e API precisam ler o mesmo
 * sensor do mesmo jeito, e a regra de "isso virou um evento" tem de ser a mesma
 * dos dois lados.
 */

// ---------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------

/** Como o fornecedor manda: `[{ name, status }]`. */
export interface StatusBruto {
  name: string;
  status: string;
}

/** O mapa cru, nome -> valor. E isto que vai pro banco em `sensores`. */
export type MapaSensores = Record<string, string>;

/**
 * Nomes que a gente TRATA de forma especial — os que viram coluna, alerta ou
 * viagem. Todo o resto continua sendo guardado e exibido; so nao tem regra.
 */
export const SENSOR = {
  COMUNICACAO: "COMMUNICATION",
  GPS: "TRACKING",
  MOVIMENTO: "MOVEMENT",
  IGNICAO: "ACC",
  BLOQUEIO: "CUT",
  BATERIA: "BAT",
  /**
   * Modo de economia do aparelho. Presente = ele DORMIU de proposito.
   *
   * Nao tem leitura booleana propria porque nao tem estado contrario: o
   * dicionario do fornecedor define um valor so (`SLEEP`), e a ausencia da chave
   * e o "acordado". O que importa dele e negativo — explicar um silencio que,
   * sem esta chave, a auditoria classificaria como aparelho com defeito.
   */
  SLEEP: "SLEEP",
} as const;

export function lerSensores(statuses: StatusBruto[] | null | undefined): MapaSensores {
  const mapa: MapaSensores = {};
  for (const s of statuses ?? []) {
    if (s && typeof s.name === "string" && typeof s.status === "string") {
      mapa[s.name] = s.status;
    }
  }
  return mapa;
}

/**
 * Tri-estado, e nao booleano — a diferenca decide se o mapa mente.
 *
 * Duas coisas que so a API REAL ensina:
 *
 * 1. Um rastreador OFFLINE reporta SO o `COMMUNICATION`. Os outros sensores nao
 *    vem. `false` diria "o GPS esta sem fix"; ausente significa "o aparelho nao
 *    contou", que e a verdade.
 * 2. O fornecedor tem um valor `UNDEFINED` — o rastreador 496538 devolve
 *    `MOVEMENT: UNDEFINED` neste momento. Ele nem consta do dicionario. Um
 *    `ligado.includes(v)` traduziria isso para "parado", e o mapa afirmaria uma
 *    coisa que ninguem mediu.
 *
 * Por isso os dois lados sao EXPLICITOS, e o que nao estiver em nenhum vira
 * `null`: valor novo do fornecedor entra como desconhecido, nunca como negativo.
 */
function literal(mapa: MapaSensores, nome: string, ligado: string[], desligado: string[]): boolean | null {
  const v = mapa[nome];
  if (v == null) return null;
  const u = v.toUpperCase();
  if (ligado.includes(u)) return true;
  if (desligado.includes(u)) return false;
  return null;
}

export function comunicando(m: MapaSensores): boolean | null {
  return literal(m, SENSOR.COMUNICACAO, ["UP", "TRUE"], ["DOWN", "FALSE"]);
}
export function rastreando(m: MapaSensores): boolean | null {
  return literal(m, SENSOR.GPS, ["ON", "TRUE"], ["OFF", "FALSE"]);
}
export function movendo(m: MapaSensores): boolean | null {
  return literal(m, SENSOR.MOVIMENTO, ["MOVING", "TRUE"], ["STOPPED", "FALSE"]);
}
export function bloqueado(m: MapaSensores): boolean | null {
  return literal(m, SENSOR.BLOQUEIO, ["ON", "TRUE"], ["OFF", "FALSE"]);
}

/**
 * Ignicao com TRES estados de verdade, nao dois.
 *
 * O fornecedor tem um valor `ANOMALY` — "Ignição com Problemas". Traduzir isso
 * pra `false` diria que o motor esta desligado, que e diferente de "o sensor de
 * ignicao esta com defeito". Num modelo em que a viagem nasce da ignicao, tratar
 * anomalia como desligado fecharia viagem sozinho.
 */
export type Ignicao = "ligada" | "desligada" | "anomalia" | null;

export function ignicao(m: MapaSensores): Ignicao {
  const v = m[SENSOR.IGNICAO];
  if (v == null) return null;
  const u = v.toUpperCase();
  if (u === "ANOMALY") return "anomalia";
  if (u === "ON" || u === "TRUE") return "ligada";
  if (u === "OFF" || u === "FALSE") return "desligada";
  return null;
}

/**
 * O aparelho esta dormindo de proposito?
 *
 * Existe para uma NEGACAO, e nao para um painel: sem isto, um rastreador em modo
 * de economia — que para de reportar por desenho — entra na auditoria da frota
 * como "sem comunicacao", ou seja, acusado de defeito. Economia de bateria e
 * silencio esperado; hardware quebrado e outra coisa, e quem le a lista precisa
 * poder distinguir antes de mandar alguem olhar o carro.
 *
 * A chave nao tem par: o dicionario do fornecedor define o valor `SLEEP` e mais
 * nenhum. Ausente = acordado.
 */
export function dormindo(m: MapaSensores): boolean {
  return m[SENSOR.SLEEP] != null;
}

export function bateriaPct(m: MapaSensores): number | null {
  const v = m[SENSOR.BATERIA];
  // `v.trim()` antes do `Number` porque `Number("")` e `Number(" ")` valem
  // ZERO, e nao NaN. Sem isto, um `BAT` vazio viraria "bateria 0%" e dispararia
  // alerta de bateria critica num aparelho que simplesmente nao mediu.
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ---------------------------------------------------------------------------
// DICIONARIO DO FORNECEDOR
// ---------------------------------------------------------------------------

export type Severidade = "success" | "warning" | "danger";

export interface DescricaoValor {
  summary?: string | null;
  severity?: string | null;
  description?: string | null;
  /** `battery-0` a `battery-4` na bateria: o icone muda com a faixa. */
  icon?: string | null;
  unit?: string | null;
}

/**
 * Faixa numerica — a forma CANONICA de um sensor `NUMBER`.
 *
 * O `EXTERNAL_BATTERY` real vem com `values` VAZIO e so tem faixa; sem ler isto,
 * a bateria externa nunca teria unidade nem severidade.
 */
export interface FaixaSensor {
  minValue: number;
  maxValue: number;
  valueDescription?: DescricaoValor;
}

export interface DescricaoSensor {
  type?: "LITERAL" | "NUMBER" | string;
  name?: string;
  icon?: string;
  values?: Record<string, DescricaoValor>;
  rangesDescriptions?: FaixaSensor[] | null;
}

/** `GET /status-descriptions`, guardado como veio. */
export type DicionarioSensores = Record<string, DescricaoSensor>;

/**
 * Rotulo do sensor em portugues, na palavra do fornecedor.
 *
 * `ACC` vira "IGNIÇÃO", `BAT` vira "BATERIA". Traduzir por conta propria seria
 * criar um segundo vocabulario pra mesma coisa — e ai a tela diria uma palavra e
 * o suporte do fornecedor, outra.
 */
export function rotuloSensor(dic: DicionarioSensores | null | undefined, nome: string): string {
  return dic?.[nome]?.name || nome;
}

/**
 * Acha a descricao exata, tolerando as tres grafias que o fornecedor mistura de
 * verdade: `COMMUNICATION` usa `True`/`False`, `SUNTECH_INPUT_TWO` usa
 * `true`/`false`, e os demais usam `ON`/`OFF`. Comparar sem normalizar acertaria
 * um sensor e erraria o outro.
 */
function acharLiteral(vals: Record<string, DescricaoValor>, valor: string): DescricaoValor | null {
  if (vals[valor]) return vals[valor]!;
  const alvo = valor.toLowerCase();
  for (const [k, v] of Object.entries(vals)) if (k.toLowerCase() === alvo) return v;
  return null;
}

/**
 * Acha a FAIXA de um valor numerico — e fecha a borda que o fornecedor deixou
 * aberta.
 *
 * As faixas de `BAT` vao de 1 a 99. O rastreador 496538 reporta **`BAT: 100`**
 * neste momento: bateria cheia cai FORA de todas as faixas deles. Sem o
 * grampeamento, o carro com a melhor bateria da frota seria o unico sem
 * severidade na tela — pareceria defeito justamente no caso saudavel.
 *
 * Grampear na faixa mais proxima mantem a classificacao do FORNECEDOR (100 cai
 * na faixa 80-99, `success`) em vez de eu inventar uma regra minha.
 */
function acharFaixa(faixas: FaixaSensor[], n: number): DescricaoValor | null {
  let acimaDeTudo: FaixaSensor | null = null;
  let abaixoDeTudo: FaixaSensor | null = null;
  for (const f of faixas) {
    if (n >= f.minValue && n <= f.maxValue) return f.valueDescription ?? null;
    if (!acimaDeTudo || f.maxValue > acimaDeTudo.maxValue) acimaDeTudo = f;
    if (!abaixoDeTudo || f.minValue < abaixoDeTudo.minValue) abaixoDeTudo = f;
  }
  if (acimaDeTudo && n > acimaDeTudo.maxValue) return acimaDeTudo.valueDescription ?? null;
  if (abaixoDeTudo && n < abaixoDeTudo.minValue) return abaixoDeTudo.valueDescription ?? null;
  return null;
}

/** `Number("")` vale ZERO — o que poria string vazia na faixa critica da bateria. */
function comoNumero(valor: string): number | null {
  if (valor.trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Literal primeiro, faixa depois — cobre `LITERAL` e `NUMBER` com um caminho so. */
function acharValor(d: DescricaoSensor | undefined, valor: string): DescricaoValor | null {
  if (!d) return null;
  const exato = d.values ? acharLiteral(d.values, valor) : null;
  if (exato) return exato;
  const n = comoNumero(valor);
  if (n === null || !d.rangesDescriptions?.length) return null;
  return acharFaixa(d.rangesDescriptions, n);
}

/**
 * Severidade de um valor — **do fornecedor, nao minha**.
 *
 * As faixas de bateria (perigo ate 15%, atencao ate 35%) sao deles. Inventar as
 * minhas seria discordar do painel que o cliente ja usa, sobre o mesmo aparelho.
 *
 * `null` quando o fornecedor nao define nem valor nem faixa — e o caso real do
 * `CUT: OFF`, que o dicionario simplesmente nao descreve. O sensor aparece na
 * tela sem cor, que e mais honesto que pintar um palpite.
 */
export function severidadeSensor(
  dic: DicionarioSensores | null | undefined,
  nome: string,
  valor: string,
): Severidade | null {
  const d = acharValor(dic?.[nome], valor);
  return d?.severity ? normalizarSeveridade(d.severity) : null;
}

function normalizarSeveridade(s: string): Severidade | null {
  const u = s.toLowerCase();
  return u === "success" || u === "warning" || u === "danger" ? u : null;
}

/**
 * BURACOS do dicionario do fornecedor, preenchidos por nos.
 *
 * Nao e traducao nem substituicao: e complemento. O dicionario real descreve
 * `CUT: ON` ("Bloqueado") e **nao descreve `CUT: OFF`** — que e o valor que o
 * aparelho reporta o dia inteiro. `MOVEMENT` documenta so `MOVING`, e o
 * rastreador responde `UNDEFINED`. Sem isto, a tela de um gestor brasileiro
 * exibe "BLOQUEIO: OFF" e "MOVIMENTAÇÃO: UNDEFINED".
 *
 * A regra que mantem isto honesto: **so entra em acao quando o fornecedor nao
 * disse nada**. Onde eles descrevem, a palavra e deles — senao a tela diria uma
 * coisa e o suporte do fornecedor, outra.
 */
const COMPLEMENTO_PT: Record<string, Record<string, string>> = {
  [SENSOR.BLOQUEIO]: { OFF: "Desbloqueado", FALSE: "Desbloqueado" },
  [SENSOR.MOVIMENTO]: { STOPPED: "Parado", UNDEFINED: "Não informado", FALSE: "Parado" },
  [SENSOR.IGNICAO]: { UNDEFINED: "Não informado" },
  [SENSOR.COMUNICACAO]: { UNDEFINED: "Não informado" },
  [SENSOR.GPS]: { UNDEFINED: "Não informado" },
};

/**
 * Texto curto do valor ("Conectado à internet", "Bloqueado", "14%", "100%").
 *
 * Para `NUMBER`, a faixa nao traz `summary` — traz a UNIDADE. Entao o texto e
 * montado com o numero REAL mais a unidade deles: `BAT: 100` vira "100%", e nao
 * o "99%" que um vizinho mais proximo diria. O numero na tela tem de ser o
 * numero que o aparelho mediu.
 */
export function resumoSensor(
  dic: DicionarioSensores | null | undefined,
  nome: string,
  valor: string,
): string {
  const d = acharValor(dic?.[nome], valor);
  if (d?.summary) return d.summary;
  if (d?.unit && comoNumero(valor) !== null) return `${valor}${d.unit}`;
  const nosso = COMPLEMENTO_PT[nome]?.[valor.toUpperCase()];
  if (nosso) return nosso;
  return valor;
}

export interface SensorExibicao {
  nome: string;
  rotulo: string;
  valor: string;
  resumo: string;
  severidade: Severidade | null;
  icone: string | null;
}

/**
 * Prepara TODOS os sensores pra tela, inclusive os que o codigo nao conhece.
 *
 * E o que faz o desenho generico valer a pena: um aparelho com `TEMPERATURE`
 * aparece com rotulo e severidade certos sem ninguem programar nada.
 */
export function sensoresParaExibir(
  mapa: MapaSensores,
  dic: DicionarioSensores | null | undefined,
): SensorExibicao[] {
  return Object.entries(mapa).map(([nome, valor]) => ({
    nome,
    rotulo: rotuloSensor(dic, nome),
    valor,
    resumo: resumoSensor(dic, nome, valor),
    severidade: severidadeSensor(dic, nome, valor),
    // O icone do VALOR ganha do icone do sensor: a bateria tem `battery-0` a
    // `battery-4` por faixa, e usar so o generico jogaria fora a informacao
    // mais util — o quanto ela caiu.
    icone: acharValor(dic?.[nome], valor)?.icon ?? dic?.[nome]?.icon ?? null,
  }));
}

// ---------------------------------------------------------------------------
// EVENTOS
// ---------------------------------------------------------------------------

export const EVENTOS_RASTREADOR = [
  "ignicao_ligada",
  "ignicao_desligada",
  "ignicao_anomalia",
  "bloqueio_ativado",
  "bloqueio_removido",
  "bateria_baixa",
  "bateria_normalizada",
  "ficou_offline",
  "voltou_online",
  "excesso_velocidade",
  /**
   * O UNICO que `derivarEventos` nao produz.
   *
   * Os outros nove nascem de comparar duas fotografias. Este nasce de DURACAO —
   * "ligado e imovel ha mais de 10 minutos" — e duas fotografias nao contem
   * tempo decorrido suficiente pra afirmar isso. Quem o emite e o job de
   * alertas, lendo `Viagem.paradoComMotorLigadoSeg` da viagem aberta.
   *
   * O tipo mora aqui mesmo assim porque a linha do tempo e o sino leem a lista
   * inteira, e um evento que existe no banco e nao existe no tipo vira "[object
   * Object]" na tela.
   */
  "parado_com_motor_ligado",
] as const;
export type EventoRastreadorTipo = (typeof EVENTOS_RASTREADOR)[number];

export const EVENTO_RASTREADOR_ROTULO: Record<EventoRastreadorTipo, string> = {
  ignicao_ligada: "Ignição ligada",
  ignicao_desligada: "Ignição desligada",
  ignicao_anomalia: "Ignição com problema",
  bloqueio_ativado: "Veículo bloqueado",
  bloqueio_removido: "Bloqueio removido",
  bateria_baixa: "Bateria fraca",
  bateria_normalizada: "Bateria normalizada",
  ficou_offline: "Rastreador sem comunicação",
  voltou_online: "Rastreador voltou a comunicar",
  excesso_velocidade: "Excesso de velocidade",
  parado_com_motor_ligado: "Parado com o motor ligado",
};

export interface EstadoSensores {
  mapa: MapaSensores;
  velocidadeKmh?: number | null;
}

export interface EventoDerivado {
  tipo: EventoRastreadorTipo;
  detalhe?: Record<string, unknown>;
}

export interface OpcoesDerivacao {
  limiteVelocidadeKmh: number;
  /** Faixa `danger` do fornecedor. Padrao 15 — o valor deles, nao um chute meu. */
  bateriaCriticaPct?: number;
}

/**
 * Compara duas fotografias e devolve o que MUDOU.
 *
 * A regra que faz o sino ser util: evento nasce da TRANSICAO, nunca do estado.
 * Bateria a 12% gera um evento quando cruza pra baixo — e nao um a cada minuto
 * enquanto continuar a 12%. Sem isso o sino vira ruido e todo mundo para de
 * olhar, que e o mesmo que nao ter alerta.
 *
 * `null` no estado anterior (primeira leitura do aparelho) NAO gera evento de
 * transicao: nao houve mudanca, houve descoberta. Anunciar "ficou offline" pra
 * um rastreador que ja estava offline quando o cadastramos seria mentira.
 */
export function derivarEventos(
  anterior: EstadoSensores | null,
  atual: EstadoSensores,
  opcoes: OpcoesDerivacao,
): EventoDerivado[] {
  const eventos: EventoDerivado[] = [];
  const critica = opcoes.bateriaCriticaPct ?? 15;

  /**
   * "NUNCA vimos este aparelho" e "o aparelho nao contou ESTE sensor" sao coisas
   * diferentes, e confundi-las fabrica eventos que nunca aconteceram.
   *
   * O caso e real e frequente: quando o rastreador fica offline, o fornecedor
   * devolve SO o `COMMUNICATION` — os outros sensores somem da resposta. Na
   * volta, um `ACC: ON` que nunca mudou apareceria como "ignicao ligada",
   * porque o snapshot anterior (o do minuto offline) nao tinha ACC nenhum. Sai
   * um alerta falso no sino e, pior, uma VIAGEM que o carro nao fez.
   *
   * Entao: sem snapshot anterior (aparelho novo) o valor de agora e uma
   * DESCOBERTA e pode virar evento; com snapshot anterior mas sem o sensor, e
   * IGNORANCIA — e ignorancia nao e transicao.
   */
  const primeiraLeitura = anterior === null;
  function mudou<T>(antes: T | null, agora: T | null): boolean {
    if (agora === null) return false;
    if (antes === null) return primeiraLeitura;
    return antes !== agora;
  }

  const igAntes = anterior ? ignicao(anterior.mapa) : null;
  const igAgora = ignicao(atual.mapa);
  if (mudou(igAntes, igAgora)) {
    if (igAgora === "ligada") eventos.push({ tipo: "ignicao_ligada" });
    else if (igAgora === "desligada" && igAntes !== null) eventos.push({ tipo: "ignicao_desligada" });
    else if (igAgora === "anomalia") eventos.push({ tipo: "ignicao_anomalia" });
  }

  const bloqAntes = anterior ? bloqueado(anterior.mapa) : null;
  const bloqAgora = bloqueado(atual.mapa);
  if (mudou(bloqAntes, bloqAgora)) {
    eventos.push({ tipo: bloqAgora ? "bloqueio_ativado" : "bloqueio_removido" });
  }

  const batAntes = anterior ? bateriaPct(anterior.mapa) : null;
  const batAgora = bateriaPct(atual.mapa);
  if (batAgora !== null) {
    const baixaAgora = batAgora <= critica;
    const baixaAntes = batAntes !== null ? batAntes <= critica : null;
    // `baixaAntes === null` com snapshot anterior = o BAT nao veio naquele
    // minuto. Nao da pra dizer que a bateria "caiu" — so que agora esta baixa.
    const sabemosDoAntes = baixaAntes !== null || primeiraLeitura;
    if (baixaAgora && baixaAntes !== true && sabemosDoAntes) {
      eventos.push({ tipo: "bateria_baixa", detalhe: { pct: batAgora } });
    } else if (!baixaAgora && baixaAntes === true) {
      eventos.push({ tipo: "bateria_normalizada", detalhe: { pct: batAgora } });
    }
  }

  const comAntes = anterior ? comunicando(anterior.mapa) : null;
  const comAgora = comunicando(atual.mapa);
  if (comAgora !== null && comAntes !== null && comAgora !== comAntes) {
    eventos.push({ tipo: comAgora ? "voltou_online" : "ficou_offline" });
  }

  /*
   * Velocidade e o unico que NAO e transicao de estado — e um fato instantaneo.
   * Mas so vale quando o valor SOBE acima do limite: sem isso, um carro a
   * 110 km/h por dez minutos geraria dez alertas iguais.
   */
  const vAgora = atual.velocidadeKmh ?? null;
  const vAntes = anterior?.velocidadeKmh ?? null;
  if (vAgora !== null && vAgora > opcoes.limiteVelocidadeKmh && (vAntes === null || vAntes <= opcoes.limiteVelocidadeKmh)) {
    eventos.push({ tipo: "excesso_velocidade", detalhe: { velocidadeKmh: Math.round(vAgora), limite: opcoes.limiteVelocidadeKmh } });
  }

  return eventos;
}
