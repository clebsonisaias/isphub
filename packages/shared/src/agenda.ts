/**
 * A AGENDA de OS — quantas visitas cabem num dia, e em qual metade dele.
 *
 * Substitui a planilha de "Controle de Agendamento de OSs" que a operacao
 * mantinha no Drive. A planilha AVISAVA ("Verificar concentracao") depois que
 * a atendente ja tinha prometido o horario ao cliente; aqui a regra e o
 * contrario: quem pergunta pelas vagas so recebe o que cabe, entao a promessa
 * nunca precisa ser desfeita.
 *
 * Mora em `shared` porque as tres pontas precisam do MESMO vocabulario: a API
 * conta, o painel do supervisor desenha a grade, e o app do tecnico ordena o
 * dia pela rota.
 */

/**
 * A metade do dia. NAO confundir com `JornadaTecnico`, que neste sistema ja se
 * chama "turno" no sentido de bater ponto — sao coisas diferentes, e por isso
 * este tipo carrega "Agenda" no nome.
 */
export const TURNOS_AGENDA = ["manha", "tarde"] as const;
export type TurnoAgenda = (typeof TURNOS_AGENDA)[number];

export const ROTULO_TURNO: Record<TurnoAgenda, string> = {
  manha: "Manhã",
  tarde: "Tarde",
};

/** De onde veio a marcacao. E a coluna "Atendente" da planilha, com procedencia. */
export const ORIGENS_AGENDAMENTO = ["isphub", "atendai_humano", "atendai_ia", "cliente", "sgp"] as const;
export type OrigemAgendamento = (typeof ORIGENS_AGENDAMENTO)[number];

export interface AgendaConfigDto {
  vagasManha: number;
  vagasTarde: number;
  /**
   * Teto do DIA inteiro, além do teto de cada turno. Nulo = sem teto próprio
   * (o limite do dia passa a ser a soma dos dois turnos).
   *
   * Existe porque os dois números respondem perguntas diferentes: o do turno é
   * quantas visitas cabem numa saída, o do dia é quantas a equipe aguenta antes
   * de a última virar madrugada. Com 20+20 e um teto diário de 30, as 10
   * últimas simplesmente não são oferecidas — em nenhum dos dois turnos.
   */
  vagasDia: number | null;
  /** Teto por regiao dentro do turno. Nulo = sem teto regional. */
  tetoRegiao: number | null;
  /** Dias da semana atendidos, 0=domingo … 6=sabado. */
  diasAtendidos: number[];
  horizonteDias: number;
  /** Antecedencia minima, em minutos, entre agora e o inicio do turno ofertado. */
  antecedenciaMin: number;
  /** Quantas vezes o proprio cliente pode remarcar sozinho. */
  remarcacoesMaxCliente: number;
  /** De onde a equipe sai de manha — origem da rota sugerida. Nulo = sem origem (a 1a parada vira origem). */
  baseLat: number | null;
  baseLng: number | null;
  /** Visitas que um tecnico faz por turno. Preenchido, a capacidade segue a escala; nulo = fixa. */
  vagasPorTecnico: number | null;
}

/** Um dia que foge da regra do calendario, como o servico o entrega. */
export interface ExcecaoAgendaDto {
  /** `AAAA-MM-DD`. */
  dia: string;
  /** false = nao atende. true = atende mesmo assim (vence tudo). */
  atende: boolean;
  motivo: string;
}

/** Por que uma janela nao pode receber mais nada. `null` = pode. */
export type BloqueioVaga =
  | "lotado"
  | "dia_lotado"
  | "regiao"
  | "dia_nao_atendido"
  /** O dia atende, mas nao neste turno — sabado a tarde. */
  | "turno_nao_atendido"
  /** A escala do dia existe e ninguem esta escalado neste turno. */
  | "sem_equipe"
  | "feriado"
  | "antecedencia";

/** Uma janela (dia + turno) da grade. */
export interface VagaTurno {
  /** `AAAA-MM-DD`. */
  dia: string;
  turno: TurnoAgenda;
  capacidade: number;
  ocupadas: number;
  /** Quantas ainda cabem. Zero quando ha bloqueio. */
  livres: number;
  bloqueio: BloqueioVaga | null;
  /** Quebra por tipo, pro painel — a planilha tinha uma aba pra cada. */
  instalacao: number;
  reparo: number;
  /** Ocupadas na regiao consultada. Nulo quando a consulta nao pediu regiao. */
  ocupadasRegiao: number | null;
  /** Total marcado no DIA (os dois turnos), pro teto diario e pro painel. */
  ocupadasDia: number;
  /**
   * Por que este dia esta fechado, em palavras — "Natal", "Padroeira de
   * Macaiba". Nulo quando o bloqueio nao e de calendario.
   *
   * Um dia que some da grade sem explicacao vira chamado interno perguntando
   * por que; com o motivo ao lado, ninguem precisa perguntar.
   */
  motivoBloqueio: string | null;
  /**
   * Quantos tecnicos a escala poe neste turno. Nulo = a capacidade e a fixa
   * (sem escala cadastrada no dia, ou `vagasPorTecnico` desligado).
   */
  tecnicosEscalados?: number | null;
}

/**
 * Capacidade de um turno quando a escala manda: min(fixa, escalados x por
 * tecnico). Sem `vagasPorTecnico` ou sem escala no dia (`escalados` nulo),
 * vale a fixa — a escala costuma ser feita na vespera, e a grade de daqui a
 * dez dias nao pode nascer zerada.
 */
export function capacidadeDerivada(fixa: number, escalados: number | null | undefined, vagasPorTecnico: number | null): number {
  if (vagasPorTecnico == null || escalados == null) return fixa;
  return Math.min(fixa, escalados * vagasPorTecnico);
}

/** Hora local (BR) em que cada turno comeca. Usada pra antecedencia e write-back. */
export const HORA_INICIO_TURNO: Record<TurnoAgenda, number> = { manha: 8, tarde: 13 };

/**
 * O turno a que uma data/hora pertence. Meio-dia em diante e tarde.
 *
 * Existe pra reconciliar OS agendadas DIRETO no SGP, que so tem data e hora e
 * nao conhecem o conceito de turno.
 */
export function turnoDaHora(horaLocal: number): TurnoAgenda {
  return horaLocal < 12 ? "manha" : "tarde";
}

// ---------------------------------------------------------------------------
// Datas do dia civil brasileiro. -03:00 FIXO, a mesma decisao de `dia.ts`.
// Moraram em apps/api/services/agendaService.ts ate 07/10/2026; vieram pro
// shared porque web e mobile precisam da MESMA resposta pra "que dia e hoje" —
// `new Date()` do navegador vira o dia numa hora diferente do servidor.
// ---------------------------------------------------------------------------

const OFFSET_BR_MIN = -180;

/** `AAAA-MM-DD` do dia CIVIL brasileiro que contem `instante`. */
export function diaBrDe(instante: Date): string {
  const local = new Date(instante.getTime() + OFFSET_BR_MIN * 60_000);
  return local.toISOString().slice(0, 10);
}

/** O dia de hoje no Brasil, `AAAA-MM-DD`. */
export function diaBrHoje(agora: Date = new Date()): string {
  return diaBrDe(agora);
}

/**
 * `AAAA-MM-DD` como o Postgres guarda um DATE (meia-noite UTC). Literal de
 * proposito: interpretar como instante local trocaria o dia por um vizinho.
 */
export function dataDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/** Soma dias a um `AAAA-MM-DD`, sem passar por fuso nenhum. */
export function somarDias(dia: string, n: number): string {
  const d = dataDoDia(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dia da semana (0=domingo) de um `AAAA-MM-DD`. */
export function diaDaSemana(dia: string): number {
  return dataDoDia(dia).getUTCDay();
}

const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * "qui 31/12 · 09:00" — o jeito unico de mostrar um instante na tela. O ano so
 * aparece quando nao e o corrente ("qui 31/12/2025 · 09:00"). Hora de Brasilia
 * (-03:00 fixo), nao a do navegador: o tecnico em viagem e o servidor em UTC
 * tem de ler o mesmo horario que o supervisor. Substitui o `toLocaleString`
 * cru, que mostrava segundos e mudava de formato conforme o navegador.
 */
export function rotuloDataHora(iso: string, agora: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const local = new Date(t + OFFSET_BR_MIN * 60_000);
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const ano = local.getUTCFullYear();
  const anoAtual = new Date(agora.getTime() + OFFSET_BR_MIN * 60_000).getUTCFullYear();
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  return `${SEMANA_CURTA[local.getUTCDay()]} ${dd}/${mm}${ano === anoAtual ? "" : `/${ano}`} · ${hh}:${mi}`;
}

/** A segunda-feira da semana que contem `dia`. Domingo pertence a semana que TERMINA nele. */
export function inicioDaSemana(dia: string): string {
  const dow = diaDaSemana(dia);
  return somarDias(dia, dow === 0 ? -6 : 1 - dow);
}

// ---------------------------------------------------------------------------
// Visita de uma OS (dia + turno da agenda ISPhub), como Fila, Mapa e app leem.
// ---------------------------------------------------------------------------

export interface ComVisita {
  diaAgenda?: string | null;
  turnoAgenda?: TurnoAgenda | null;
  ordemRota?: number | null;
}

export type JanelaVisita = "hoje" | "amanha" | "semana" | "depois" | "passada";

/** Em que janela relativa a `hoje` cai um dia de visita. `semana` = ate 7 dias a frente. */
export function janelaVisita(dia: string, hoje: string): JanelaVisita {
  if (dia < hoje) return "passada";
  if (dia === hoje) return "hoje";
  if (dia === somarDias(hoje, 1)) return "amanha";
  if (dia <= somarDias(hoje, 7)) return "semana";
  return "depois";
}

/** Chave de agrupamento: `"dia|turno"`, ou `"sem_visita"`. */
export function chaveVisita(item: ComVisita): string {
  return item.diaAgenda && item.turnoAgenda ? `${item.diaAgenda}|${item.turnoAgenda}` : "sem_visita";
}

const ORDEM_TURNO: Record<TurnoAgenda, number> = { manha: 0, tarde: 1 };

/**
 * Ordem da agenda: dia, depois turno, depois a posicao na rota (sem rota vai
 * pro fim do turno). Quem nao tem visita vai pro fim de tudo. Devolve 0 em
 * empate — quem chama desempata (urgencia, hora).
 */
export function compararVisita(a: ComVisita, b: ComVisita): number {
  const va = a.diaAgenda && a.turnoAgenda;
  const vb = b.diaAgenda && b.turnoAgenda;
  if (!va && !vb) return 0;
  if (!va) return 1;
  if (!vb) return -1;
  if (a.diaAgenda! !== b.diaAgenda!) return a.diaAgenda! < b.diaAgenda! ? -1 : 1;
  const t = ORDEM_TURNO[a.turnoAgenda!] - ORDEM_TURNO[b.turnoAgenda!];
  if (t !== 0) return t;
  return (a.ordemRota ?? Number.POSITIVE_INFINITY) - (b.ordemRota ?? Number.POSITIVE_INFINITY);
}
