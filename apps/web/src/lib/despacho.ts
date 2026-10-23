import { OsStatus, type FilaItem, type SlaSemaforo, type TurnoAgenda } from "@isphub/shared";
import type { ParadaAgenda } from "./agendaApi";

/**
 * DESPACHO — a logica do Quadro do dia, separada da tela pra ter teste.
 *
 * O quadro e uma linha por tecnico com as paradas da manha e da tarde, como a
 * planilha fazia com "Tecnico designado" + "Ordem da rota". As paradas vem da
 * agenda (todas as marcadas, ate as ja concluidas) e o prazo vem da fila (so
 * as abertas tem SLA que ainda importa).
 */

export interface Parada {
  /** Id da MARCACAO (Agendamento). */
  id: string;
  osId: string | null;
  sgpOsId: string;
  provedorId: string;
  turno: TurnoAgenda;
  tecnicoId: string | null;
  tecnicoNome: string | null;
  apoios: { id: string; nome: string }[];
  cor: string;
  categoria: string;
  local: string | null;
  /** A regiao gravada na marcacao (teto por regiao): remarcar mantem a mesma. */
  regiao: string | null;
  cliente: string | null;
  status: OsStatus | null;
  ordemRota: number | null;
  sla: SlaSemaforo | null;
  lat: number | null;
  lng: number | null;
}

export interface LinhaQuadro {
  /** Nulo = a linha "Sem tecnico". */
  tecnicoId: string | null;
  nome: string;
  /** Quem foi de apoio com ele hoje (uniao das paradas), sem repetir. */
  apoio: string[];
  manha: Parada[];
  tarde: Parada[];
}

const COR_SEM_CATEGORIA = "#64748b";
const nomeCurto = (u: { nome: string; nomeExibicao?: string | null }) => u.nomeExibicao ?? u.nome;

export function paradaDe(p: ParadaAgenda, turno: TurnoAgenda, slaPorOs: Map<string, SlaSemaforo>): Parada {
  const os = p.ordemServico;
  return {
    id: p.id,
    osId: os?.id ?? null,
    sgpOsId: p.sgpOsId,
    provedorId: p.provedor.id,
    turno,
    tecnicoId: os?.tecnico?.id ?? null,
    tecnicoNome: os?.tecnico ? nomeCurto(os.tecnico) : null,
    apoios: (os?.apoios ?? []).map((a) => ({ id: a.id, nome: nomeCurto(a) })),
    cor: os?.tipoOs?.categoria?.cor ?? COR_SEM_CATEGORIA,
    categoria: os?.tipoOs?.categoria?.nome ?? os?.tipoOs?.descricao ?? "Sem categoria",
    local: os?.bairro ?? os?.pop ?? p.regiao,
    regiao: p.regiao,
    cliente: os?.clienteNome ?? null,
    status: os?.status ?? null,
    ordemRota: p.ordemRota,
    sla: os ? (slaPorOs.get(os.id) ?? null) : null,
    lat: os?.lat ?? null,
    lng: os?.lng ?? null,
  };
}

const porRota = (a: Parada, b: Parada) =>
  (a.ordemRota ?? Number.MAX_SAFE_INTEGER) - (b.ordemRota ?? Number.MAX_SAFE_INTEGER) || a.sgpOsId.localeCompare(b.sgpOsId);

/**
 * As linhas do quadro. "Sem tecnico" sempre primeiro (e onde se larga OS nova).
 * Por padrao entram: quem tem parada no dia e quem esta na escala — menos quem
 * so aparece como APOIO de alguem (ele vai junto, nao tem rota propria).
 * `todos` poe na tela todo tecnico ativo, pra servir de alvo.
 */
export function montarQuadro(
  paradas: Parada[],
  tecnicos: { id: string; nome: string }[],
  escalados: Set<string>,
  todos = false,
): LinhaQuadro[] {
  const doTecnico = new Map<string, Parada[]>();
  const semTecnico: Parada[] = [];
  const apoioDoDia = new Set<string>();
  for (const p of paradas) {
    p.apoios.forEach((a) => apoioDoDia.add(a.id));
    if (!p.tecnicoId) semTecnico.push(p);
    else doTecnico.set(p.tecnicoId, [...(doTecnico.get(p.tecnicoId) ?? []), p]);
  }

  const nomes = new Map(tecnicos.map((t) => [t.id, t.nome]));
  // Tecnico com parada mas fora da lista (desativado depois de marcado): entra com o nome da parada.
  for (const [id, ps] of doTecnico) if (!nomes.has(id)) nomes.set(id, ps[0]!.tecnicoNome ?? "Técnico");

  const ids = [...nomes.keys()].filter(
    (id) => todos || doTecnico.has(id) || (escalados.has(id) && !apoioDoDia.has(id)),
  );

  const linha = (tecnicoId: string | null, nome: string, ps: Parada[]): LinhaQuadro => {
    const apoio: string[] = [];
    for (const p of ps) for (const a of p.apoios) if (a.id !== tecnicoId && !apoio.includes(a.nome)) apoio.push(a.nome);
    return {
      tecnicoId,
      nome,
      apoio,
      manha: ps.filter((p) => p.turno === "manha").sort(porRota),
      tarde: ps.filter((p) => p.turno === "tarde").sort(porRota),
    };
  };

  const linhas = ids
    .map((id) => linha(id, nomes.get(id)!, doTecnico.get(id) ?? []))
    .sort((a, b) => Number(b.manha.length + b.tarde.length > 0) - Number(a.manha.length + a.tarde.length > 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  return [linha(null, "Sem técnico", semTecnico), ...linhas];
}

const PESO_SLA: Record<SlaSemaforo, number> = { vermelho: 0, amarelo: 1, verde: 2, sem_sla: 3 };

/** OS abertas sem visita, urgentes primeiro: prazo estourado, vencendo, depois as mais antigas. */
export function paraAgendar(itens: FilaItem[]): FilaItem[] {
  return itens
    .filter((i) => !i.diaAgenda)
    .sort(
      (a, b) =>
        PESO_SLA[a.sla.semaforo] - PESO_SLA[b.sla.semaforo] ||
        (a.sla.minutosRestantes ?? Number.MAX_SAFE_INTEGER) - (b.sla.minutosRestantes ?? Number.MAX_SAFE_INTEGER) ||
        (a.dataCadastro ?? "").localeCompare(b.dataCadastro ?? ""),
    );
}

export type Arrasto = { tipo: "nova"; item: FilaItem } | { tipo: "parada"; parada: Parada };
export interface Destino {
  tecnicoId: string | null;
  turno: TurnoAgenda;
}
export type AcaoDrop =
  | { tipo: "fazer"; marcarTurno: TurnoAgenda | null; atribuir: string | null }
  | { tipo: "recusar"; motivo: string }
  | { tipo: "nada" };

const ENCERRADA: (OsStatus | null)[] = [OsStatus.CONCLUIDA, OsStatus.CANCELADA];

/**
 * O que soltar uma OS numa celula do quadro faz. Marcar (ou mudar de turno) e
 * atribuir sao as duas escritas possiveis; tirar o tecnico nao e uma delas — a
 * API nao desatribui, e isso continua sendo feito na OS.
 */
export function acaoDoDrop(a: Arrasto, d: Destino, turnoFechado: (t: TurnoAgenda) => string | null): AcaoDrop {
  const fechado = turnoFechado(d.turno);
  if (a.tipo === "nova") {
    if (fechado) return { tipo: "recusar", motivo: fechado };
    return { tipo: "fazer", marcarTurno: d.turno, atribuir: d.tecnicoId };
  }
  const p = a.parada;
  if (ENCERRADA.includes(p.status)) return { tipo: "recusar", motivo: "Esta OS já foi encerrada." };
  const mudaTurno = d.turno !== p.turno;
  if (mudaTurno && fechado) return { tipo: "recusar", motivo: fechado };
  if (d.tecnicoId === null && p.tecnicoId) {
    return { tipo: "recusar", motivo: "Para tirar o técnico, abra a OS." };
  }
  const atribuir = d.tecnicoId && d.tecnicoId !== p.tecnicoId ? d.tecnicoId : null;
  if (atribuir && !p.osId) return { tipo: "recusar", motivo: "Esta OS ainda não chegou do SGP; atribua depois do próximo sync." };
  if (!mudaTurno && !atribuir) return { tipo: "nada" };
  return { tipo: "fazer", marcarTurno: mudaTurno ? d.turno : null, atribuir };
}
