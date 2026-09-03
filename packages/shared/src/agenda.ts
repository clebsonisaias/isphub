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
}

/** Por que uma janela nao pode receber mais nada. `null` = pode. */
export type BloqueioVaga =
  | "lotado"
  | "dia_lotado"
  | "regiao"
  | "dia_nao_atendido"
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
