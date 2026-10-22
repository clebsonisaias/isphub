import { TURNOS_AGENDA, type TurnoAgenda, type VagaTurno } from "./agenda.js";

/**
 * O motor que PROPOE dia e turno pra OS abertas. Puro: nao le banco, nao grava,
 * nao atribui tecnico — quem escolhe tecnico e aprova e o supervisor.
 *
 * Duas filas, uma capacidade. A retirada (remocao de kit, 94% do backlog) e
 * uma FATIA do que o dia comporta, nao vaga extra: a fila normal nunca ocupa a
 * parte reservada a ela, e ela so recebe depois das demais (usa a sobra). Sem
 * a reserva, o backlog soterraria quem esta sem internet por semanas.
 */

export type FilaAgenda = "normal" | "retirada";

/**
 * Origem das marcacoes feitas pelo agendador (job ou lote aprovado). Fora de
 * `ORIGENS_AGENDAMENTO` de proposito: aquele enum alimenta a rota manual, e
 * quem pudesse mandar "auto" por la teria a marcacao desfeita junto com o lote.
 */
export const ORIGEM_AUTO = "auto";

export interface CandidataAuto {
  provedorId: string;
  sgpOsId: string;
  clienteNome: string | null;
  /** Nulo = "Nao classificado": nao agenda sozinha, vai pra revisao. */
  categoria: string | null;
  /** Categoria de equipe externa (retirada/cancelamento) = fila de retirada. */
  equipeExterna: boolean;
  /** Descricao do tipo de OS ("Sem conexao", "Instalacao FTTH"...). */
  tipo: string | null;
  /** 1 baixa, 2 normal, 3 alta (`OsPrioridade`). */
  prioridade: number;
  slaEstourado: boolean;
  dataCadastro: Date | null;
  contratoStatus: string | null;
  /** POP/bairro — a chave da concentracao. */
  regiao: string | null;
  /** Contrato no SGP; com `tipo`, identifica a OS duplicada. */
  contratoId?: string | null;
  /**
   * Ja existe visita marcada de outra OS do mesmo contrato e tipo. Sem isto, a
   * duplicata de uma OS que acabou de ser agendada deixa de parecer duplicata
   * (a original saiu da lista) e ganha vaga na rodada seguinte.
   */
  duplicaMarcada?: boolean;
}

/** A identidade da "mesma visita": contrato + tipo, sem acento nem caixa. */
export function chaveDeDuplicada(provedorId: string, contratoId: string | null | undefined, tipo: string | null) {
  return contratoId ? `${provedorId}|${contratoId}|${semAcento(tipo)}` : null;
}

const semAcento = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * OS de teste ("ATENDAI TESTE APAGAR DOIS") nao entram na agenda de verdade.
 *
 * ponytail: olha so o nome do cliente — o corpo da OS diz "teste de
 * velocidade" em reparo legitimo. Contrato de teste com nome normal passa; se
 * aparecer, vira lista de contratos ignorados.
 */
export function ehOsDeTeste(clienteNome: string | null): boolean {
  return /\b(teste|apagar)\b/.test(semAcento(clienteNome));
}

/** 0 reparo sem conexao, 1 instalacao, 2 o resto. */
export function classeDaOs(c: Pick<CandidataAuto, "tipo" | "categoria">): 0 | 1 | 2 {
  const texto = `${semAcento(c.tipo)} ${semAcento(c.categoria)}`;
  if (texto.includes("sem conex")) return 0;
  if (texto.includes("instala")) return 1;
  return 2;
}

/**
 * Pra onde a OS vai: uma das filas, ou revisao com o motivo. Contrato
 * Cancelado so faz sentido na retirada (recolher o kit) — instalar ou reparar
 * pra quem cancelou e visita perdida.
 */
export function destinoDaCandidata(c: CandidataAuto): { fila: FilaAgenda } | { revisao: string } {
  if (c.categoria == null) return { revisao: "Tipo de OS sem categoria — classifique antes de agendar." };
  if (c.equipeExterna) return { fila: "retirada" };
  const contrato = semAcento(c.contratoStatus);
  if (contrato.includes("cancel")) {
    return { revisao: "Contrato cancelado fora da fila de retirada — confirme se a visita ainda faz sentido." };
  }
  // Bloqueado/suspenso e caso financeiro: visita tecnica nao resolve e o
  // tecnico chega a uma casa sem servico a prestar.
  if (contrato.includes("suspens") || contrato.includes("bloque")) {
    return { revisao: "Contrato suspenso/bloqueado — é financeiro, não técnico. Regularize antes de agendar." };
  }
  return { fila: "normal" };
}

/**
 * Quem agenda primeiro: classe (sem conexao > instalacao > resto), prioridade,
 * SLA estourado, e por fim a mais antiga. Estavel; nao muda a entrada.
 */
export function ordenarCandidatas<T extends CandidataAuto>(lista: T[]): T[] {
  return [...lista].sort(
    (a, b) =>
      classeDaOs(a) - classeDaOs(b) ||
      b.prioridade - a.prioridade ||
      Number(b.slaEstourado) - Number(a.slaEstourado) ||
      (a.dataCadastro?.getTime() ?? Infinity) - (b.dataCadastro?.getTime() ?? Infinity),
  );
}

/** Uma janela como o motor a enxerga: o que ainda cabe, ja descontado o marcado. */
export interface JanelaPool {
  dia: string;
  turno: TurnoAgenda;
  livresTurno: number;
  livresDia: number;
  /**
   * Vagas do dia guardadas pra "sem conexao" que ainda nao chegou. So as
   * urgentes as usam; as demais enxergam o dia menor por esse tanto.
   */
  reservaUrgencia?: number;
  /** Visitas da MESMA regiao ja marcadas aqui. */
  naRegiao: number;
}

/** Janela da fila normal, a partir do que `proximasVagas` devolve. */
export function janelaDeVaga(v: VagaTurno, tetoDia: number, reservaDia = 0): JanelaPool {
  return {
    dia: v.dia,
    turno: v.turno,
    livresTurno: v.capacidade - v.ocupadas,
    // `tetoDia`: o que o dia comporta (`vagasDia`, ou a soma dos turnos).
    // `reservaDia`: o que falta da fatia da retirada — a fila normal nao a ocupa.
    livresDia: tetoDia - v.ocupadasDia - reservaDia,
    naRegiao: v.ocupadasRegiao ?? 0,
  };
}

export interface PropostaAuto {
  provedorId: string;
  sgpOsId: string;
  clienteNome: string | null;
  dia: string;
  turno: TurnoAgenda;
  regiao: string | null;
  fila: FilaAgenda;
  motivo: string;
}

export interface ResultadoAuto {
  propostas: PropostaAuto[];
  /** Precisam de gente: sem categoria, contrato cancelado fora da retirada. */
  revisao: { provedorId: string; sgpOsId: string; motivo: string }[];
  /** Classificadas, mas sem janela no horizonte. */
  semVaga: { provedorId: string; sgpOsId: string; fila: FilaAgenda }[];
}

/**
 * Duas OS abertas do MESMO contrato e tipo sao uma visita so: agenda a mais
 * antiga e manda a outra pra revisao, em vez de gastar duas vagas.
 */
export function separarDuplicadas<T extends CandidataAuto>(lista: T[]): { unicas: T[]; duplicadas: T[] } {
  const chave = (c: T) => chaveDeDuplicada(c.provedorId, c.contratoId, c.tipo);
  const maisAntiga = new Map<string, T>();
  for (const c of lista) {
    const k = chave(c);
    if (!k) continue;
    const atual = maisAntiga.get(k);
    if (!atual || (c.dataCadastro?.getTime() ?? Infinity) < (atual.dataCadastro?.getTime() ?? Infinity)) maisAntiga.set(k, c);
  }
  const unicas: T[] = [];
  const duplicadas: T[] = [];
  for (const c of lista) {
    const k = chave(c);
    (k && maisAntiga.get(k) !== c ? duplicadas : unicas).push(c);
  }
  return { unicas, duplicadas };
}

/** Quantas janelas livres, em ordem, o motor compara pra preferir a que concentra. */
const JANELAS_COMPARADAS = 4;

const chaveRegiao = (r: string | null) => r ?? "";

/**
 * Distribui as candidatas nas janelas, uma a uma, na ordem de prioridade.
 *
 * Concentracao: entre as primeiras janelas livres, prefere a que ja tem a
 * mesma regiao (menos deslocamento); empate = a mais cedo. `tetoRegiao`
 * continua teto DURO — a preferencia nunca o fura.
 *
 * ponytail: guloso, olha so as primeiras 4 janelas. Nao reorganiza o que ja foi
 * proposto; se o backlog ficar mal empacotado, vira um passo de melhoria local.
 */
export function proporAgenda(args: {
  candidatas: CandidataAuto[];
  /** Janelas por regiao ("" = sem regiao), ordem cronologica. */
  normal: Map<string, JanelaPool[]>;
  retirada: Map<string, JanelaPool[]>;
  tetoRegiao: number | null;
}): ResultadoAuto {
  const resultado: ResultadoAuto = { propostas: [], revisao: [], semVaga: [] };
  const aceitas: (CandidataAuto & { fila: FilaAgenda })[] = [];
  const { unicas, duplicadas } = separarDuplicadas(args.candidatas.filter((c) => !ehOsDeTeste(c.clienteNome)));
  for (const c of duplicadas) {
    resultado.revisao.push({
      provedorId: c.provedorId,
      sgpOsId: c.sgpOsId,
      motivo: "Duplicada — já há OS aberta do mesmo contrato e tipo; a mais antiga é a que agenda.",
    });
  }
  for (const c of unicas) {
    if (c.duplicaMarcada) {
      resultado.revisao.push({
        provedorId: c.provedorId,
        sgpOsId: c.sgpOsId,
        motivo: "Duplicada — o mesmo contrato e tipo já têm visita marcada.",
      });
      continue;
    }
    const d = destinoDaCandidata(c);
    if ("revisao" in d) resultado.revisao.push({ provedorId: c.provedorId, sgpOsId: c.sgpOsId, motivo: d.revisao });
    else aceitas.push({ ...c, fila: d.fila });
  }

  // Turno e dia sao UM contador so, compartilhado: a capacidade e global.
  const janelaUsada = new Map<string, number>();
  const diaUsado = new Map<string, number>();
  // Urgentes ja postas por dia nesta rodada: encolhem a reserva que sobra.
  const urgenciaUsada = new Map<string, number>();
  const estado = {
    normal: { janela: janelaUsada, dia: diaUsado, regiao: new Map<string, number>() },
    retirada: { janela: janelaUsada, dia: diaUsado, regiao: new Map<string, number>() },
  };
  const ordemTurno = (t: TurnoAgenda) => TURNOS_AGENDA.indexOf(t);

  const ordenadas = ordenarCandidatas(aceitas);
  for (const c of [...ordenadas.filter((x) => x.fila === "normal"), ...ordenadas.filter((x) => x.fila === "retirada")]) {
    const pool = (c.fila === "retirada" ? args.retirada : args.normal).get(chaveRegiao(c.regiao)) ?? [];
    const st = estado[c.fila];
    const teto = c.fila === "normal" ? args.tetoRegiao : null;
    const kJ = (j: JanelaPool) => `${j.dia}|${j.turno}`;
    const kR = (j: JanelaPool) => `${kJ(j)}|${chaveRegiao(c.regiao)}`;
    const jaNaRegiao = (j: JanelaPool) => j.naRegiao + (st.regiao.get(kR(j)) ?? 0);

    const urgente = c.fila === "normal" && classeDaOs(c) === 0;
    // So a urgencia enxerga o dia inteiro; as demais deixam a reserva intacta.
    const reservada = (j: JanelaPool) =>
      c.fila === "normal" && !urgente ? Math.max(0, (j.reservaUrgencia ?? 0) - (urgenciaUsada.get(j.dia) ?? 0)) : 0;

    const cabem = pool
      .filter(
        (j) =>
          j.livresTurno - (st.janela.get(kJ(j)) ?? 0) > 0 &&
          j.livresDia - reservada(j) - (st.dia.get(j.dia) ?? 0) > 0 &&
          (teto == null || c.regiao == null || jaNaRegiao(j) < teto),
      )
      .sort((a, b) => a.dia.localeCompare(b.dia) || ordemTurno(a.turno) - ordemTurno(b.turno))
      .slice(0, JANELAS_COMPARADAS);

    if (cabem.length === 0) {
      resultado.semVaga.push({ provedorId: c.provedorId, sgpOsId: c.sgpOsId, fila: c.fila });
      continue;
    }
    let escolhida = cabem[0]!;
    if (c.regiao != null) for (const j of cabem) if (jaNaRegiao(j) > jaNaRegiao(escolhida)) escolhida = j;

    st.janela.set(kJ(escolhida), (st.janela.get(kJ(escolhida)) ?? 0) + 1);
    st.dia.set(escolhida.dia, (st.dia.get(escolhida.dia) ?? 0) + 1);
    st.regiao.set(kR(escolhida), (st.regiao.get(kR(escolhida)) ?? 0) + 1);
    if (urgente) urgenciaUsada.set(escolhida.dia, (urgenciaUsada.get(escolhida.dia) ?? 0) + 1);

    const juntas = jaNaRegiao(escolhida) - 1; // sem contar a propria
    const motivo = [
      c.fila === "retirada" ? "Retirada" : ["Reparo sem conexão", "Instalação", "Atendimento"][classeDaOs(c)],
      c.prioridade >= 3 ? "prioridade alta" : null,
      c.slaEstourado ? "SLA estourado" : null,
      c.regiao != null && juntas > 0
        ? `junto de ${juntas} ${juntas === 1 ? "visita" : "visitas"} em ${c.regiao}`
        : "primeira vaga livre",
    ]
      .filter(Boolean)
      .join(" · ");

    resultado.propostas.push({
      provedorId: c.provedorId,
      sgpOsId: c.sgpOsId,
      clienteNome: c.clienteNome,
      dia: escolhida.dia,
      turno: escolhida.turno,
      regiao: c.regiao,
      fila: c.fila,
      motivo,
    });
  }
  return resultado;
}
