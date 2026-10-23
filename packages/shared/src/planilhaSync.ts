import type { TurnoAgenda } from "./agenda.js";

/**
 * Robo planilha -> ISPhub: enquanto as atendentes ainda agendam na planilha do
 * Drive, o ISPhub copia de la. Este arquivo e a DECISAO, pura: dada a linha da
 * planilha e o que a agenda ja tem, o que fazer. Ler o Drive e gravar ficam no
 * servico.
 *
 * Um sentido so (planilha -> ISPhub). Quem mexeu direto no ISPhub vence: o robo
 * nao sobrescreve marcacao que nao e dele, lista como conflito.
 */

export const ORIGEM_PLANILHA = "planilha";

export interface LinhaPlanilha {
  /** Numero da OS no SGP, so digitos. Nulo = a linha nao tem OS utilizavel. */
  os: string | null;
  dia: string | null;
  turno: TurnoAgenda | null;
  /** Coluna "Status" crua: "", "Roteirizada", "Concluída", "Cancelada". */
  status: string;
  atendente: string | null;
  aba: "instalacao" | "reparo";
  /** Colunas do supervisor e da atendente que nao decidem a vaga (opcionais na planilha). */
  tecnico?: string | null;
  ordem?: number | null;
  observacao?: string | null;
}

/** O que a agenda tem hoje pra OS (so marcacao ativa interessa). */
export interface MarcacaoAtual {
  id: string;
  dia: string;
  turno: TurnoAgenda;
  status: string;
  origem: string;
  observacao: string | null;
}

export type DecisaoPlanilha =
  | { tipo: "marcar" }
  | { tipo: "desmarcar"; id: string }
  | { tipo: "nada" }
  | { tipo: "ignorar"; motivo: string }
  | { tipo: "conflito"; motivo: string };

/** Prefixo da observacao das marcacoes que vieram da planilha (inclusive as do 1o lote, a mao). */
export const OBSERVACAO_PLANILHA = "Migrado da planilha";

const semAcento = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** "OS-212760", "212760", "  212760 " -> "212760". Outra coisa (nome, "ID 136279") -> null. */
export function osDaCelula(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(?:os[-\s]*)?(\d{4,8})$/i.exec(s);
  return m ? m[1]! : null;
}

/**
 * Data da celula: serial do Excel (46281 = 16/09/2026) ou texto "dd/mm/aaaa".
 * Texto mal digitado ("1709/2026") vira nulo — e a linha cai em "sem data".
 */
export function diaDaCelula(v: unknown): string | null {
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const serial = Number(v);
    if (serial < 30000 || serial > 80000) return null; // fora de 1982..2119: nao e data
    // Epoca do Excel e 30/12/1899 (o bug do 29/02/1900 ja esta embutido nela).
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(a, mes - 1, d));
  // Rejeita 31/02 e afins, que o Date "corrigiria" pro mes seguinte.
  if (data.getUTCDate() !== d || data.getUTCMonth() !== mes - 1) return null;
  return data.toISOString().slice(0, 10);
}

export function turnoDaCelula(v: unknown): TurnoAgenda | null {
  const s = semAcento(String(v ?? ""));
  if (s.startsWith("manha")) return "manha";
  if (s.startsWith("tarde")) return "tarde";
  return null;
}

/** Marcacao que o robo (ou o carregamento a mao da planilha) criou — so essas ele pode mudar. */
export function ehDaPlanilha(m: Pick<MarcacaoAtual, "origem" | "observacao">): boolean {
  return m.origem === ORIGEM_PLANILHA || (m.observacao ?? "").startsWith(OBSERVACAO_PLANILHA);
}

/** Linha que ainda vale (nao concluida nem cancelada). */
export function linhaAtiva(l: Pick<LinhaPlanilha, "status">): boolean {
  const s = semAcento(l.status);
  return !s.startsWith("conclu") && !s.startsWith("cancel");
}

/**
 * Chave de comparacao de nome de tecnico: sem acento, caixa nem apelido entre
 * parenteses — a planilha escreve "Izarleson (Major)", o cadastro pode nao ter.
 */
export function chaveNome(nome: string | null | undefined): string {
  return semAcento(nome).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

/** "Tecnico 16"... da lista de Configuracoes sao vagas de reserva, nao pessoas. */
export function ehVagaDeReserva(nome: string): boolean {
  return /^tecnico \d+$/.test(chaveNome(nome));
}

/** Observacao gravada na marcacao do robo: o prefixo (que diz "e da planilha") + a da atendente. */
export function observacaoDoRobo(obs: string | null | undefined): string {
  const texto = (obs ?? "").trim();
  return (texto ? `${OBSERVACAO_PLANILHA} (robô) · ${texto}` : `${OBSERVACAO_PLANILHA} (robô)`).slice(0, 500);
}

/**
 * A mesma OS em mais de uma linha (remarcada copiando a linha). Linha ATIVA vence
 * linha concluida/cancelada; entre ativas, vale a ultima (a mais recente na
 * ordem em que a atendente escreve).
 *
 * "Ultima linha vence" puro desmarcou visita valida em producao (OS 213238,
 * 22/10/2026): 24/10 ativa na linha 243, 22/10 Cancelada na linha 250 — a
 * cancelada era de OUTRA data e nao dizia nada sobre a de 24/10.
 */
export function consolidarLinhas(linhas: LinhaPlanilha[]): LinhaPlanilha[] {
  const ativa = linhaAtiva;
  const escolhida = new Map<string, LinhaPlanilha>();
  const semOs: LinhaPlanilha[] = [];
  for (const l of linhas) {
    if (!l.os) {
      semOs.push(l);
      continue;
    }
    const atual = escolhida.get(l.os);
    // Ativa so e trocada por outra ativa; encerrada so por qualquer linha mais nova.
    if (!atual || ativa(l) || !ativa(atual)) escolhida.set(l.os, l);
  }
  return [...escolhida.values(), ...semOs];
}

export function decidirLinha(args: {
  linha: LinhaPlanilha;
  atual: MarcacaoAtual | null;
  /** AAAA-MM-DD de hoje, hora de Brasilia. */
  hoje: string;
  /** A OS no espelho do ISPhub: true aberta, false fechada, null ainda nao espelhada. */
  osAberta: boolean | null;
}): DecisaoPlanilha {
  const { linha, atual, hoje, osAberta } = args;
  const status = semAcento(linha.status);
  const marcada = atual?.status === "marcado" ? atual : null;

  if (status.startsWith("conclu")) return { tipo: "nada" };
  if (status.startsWith("cancel")) {
    // So desfaz o que e da planilha: visita que o supervisor ou o AtendAI marcou
    // nao some porque alguem riscou a linha.
    return marcada && ehDaPlanilha(marcada) ? { tipo: "desmarcar", id: marcada.id } : { tipo: "nada" };
  }

  if (!linha.os) return { tipo: "ignorar", motivo: "sem número de OS" };
  if (!linha.dia) return { tipo: "ignorar", motivo: "sem data agendada válida" };
  if (!linha.turno) return { tipo: "ignorar", motivo: "turno inválido" };

  if (marcada && marcada.dia === linha.dia && marcada.turno === linha.turno) return { tipo: "nada" };
  if (linha.dia < hoje) return { tipo: "ignorar", motivo: `data passada (${linha.dia})` };
  if (osAberta === false) return { tipo: "ignorar", motivo: "OS já fechada" };

  if (marcada && !ehDaPlanilha(marcada)) {
    return {
      tipo: "conflito",
      motivo: `no ISPhub está ${marcada.dia} ${marcada.turno} (origem ${marcada.origem}); a planilha diz ${linha.dia} ${linha.turno}`,
    };
  }
  return { tipo: "marcar" };
}
