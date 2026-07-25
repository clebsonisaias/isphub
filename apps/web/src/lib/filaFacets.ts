import {
  CategoriaTipoOs,
  OS_STATUS_LABEL,
  OsPrioridade,
  OsStatus,
  type FilaItem,
} from "@isphub/shared";
import { SLA_PRIORIDADE } from "@/components/SlaBadge";

export type KindFiltro = "todos" | "os" | "ocorrencia";

export interface FilaFacetState {
  kind: KindFiltro;
  status: OsStatus | "todos";
  prioridade: OsPrioridade | "todas";
  categoria: CategoriaTipoOs | "todas";
  provedorId: string | "todos";
  busca: string;
}

export const FILA_FACET_INICIAL: FilaFacetState = {
  kind: "todos",
  status: "todos",
  prioridade: "todas",
  categoria: "todas",
  provedorId: "todos",
  busca: "",
};

export const PRIORIDADE_LABEL: Record<OsPrioridade, string> = {
  [OsPrioridade.ALTA]: "Alta",
  [OsPrioridade.NORMAL]: "Normal",
  [OsPrioridade.BAIXA]: "Baixa",
};

export const CATEGORIA_LABEL: Record<CategoriaTipoOs, string> = {
  [CategoriaTipoOs.OCORRENCIA]: "Ocorrência",
  [CategoriaTipoOs.INSTALACAO]: "Instalação",
};

/** Aplica um predicado por dimensão, ignorando a própria dimensão (para faceta "OR dentro, AND entre"). */
function passaKind(item: FilaItem, f: FilaFacetState) {
  return f.kind === "todos" || item.kind === f.kind;
}
function passaStatus(item: FilaItem, f: FilaFacetState) {
  return f.status === "todos" || (item.kind === "os" && item.status === f.status);
}
function passaPrioridade(item: FilaItem, f: FilaFacetState) {
  return f.prioridade === "todas" || (item.kind === "os" && item.prioridade === f.prioridade);
}
function passaCategoria(item: FilaItem, f: FilaFacetState) {
  return f.categoria === "todas" || (item.kind === "os" && item.categoria === f.categoria);
}
function passaProvedor(item: FilaItem, f: FilaFacetState) {
  return f.provedorId === "todos" || item.provedorId === f.provedorId;
}

/** Aplica todos os filtros (a busca já vem resolvida do servidor, mas mantemos por segurança). */
export function filtrarFila(itens: FilaItem[], f: FilaFacetState): FilaItem[] {
  return itens.filter(
    (i) => passaKind(i, f) && passaStatus(i, f) && passaPrioridade(i, f) && passaCategoria(i, f) && passaProvedor(i, f),
  );
}

/**
 * Contagem por opção de UMA dimensão, respeitando os filtros das OUTRAS
 * dimensões (contadores "vivos" como no modelo). Ex.: quantos itens de cada
 * status existem dado o provedor/tipo já filtrados.
 */
function contarPor<T extends string | number>(
  itens: FilaItem[],
  f: FilaFacetState,
  ignorar: keyof FilaFacetState,
  chave: (i: FilaItem) => T | null,
): Map<T, number> {
  const parcial: FilaFacetState = { ...f, [ignorar]: ignorarValor(ignorar) };
  const base = filtrarFila(itens, parcial);
  const mapa = new Map<T, number>();
  for (const i of base) {
    const k = chave(i);
    if (k === null) continue;
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return mapa;
}

function ignorarValor(dim: keyof FilaFacetState): FilaFacetState[keyof FilaFacetState] {
  switch (dim) {
    case "kind":
      return "todos";
    case "status":
      return "todos";
    case "prioridade":
      return "todas";
    case "categoria":
      return "todas";
    case "provedorId":
      return "todos";
    default:
      return "";
  }
}

export interface FilaFacetCounts {
  total: number;
  porKind: { os: number; ocorrencia: number };
  porStatus: Map<OsStatus, number>;
  porPrioridade: Map<OsPrioridade, number>;
  porCategoria: Map<CategoriaTipoOs, number>;
  porProvedor: Map<string, number>;
}

export function calcularFacetas(itens: FilaItem[], f: FilaFacetState): FilaFacetCounts {
  const kindMap = contarPor(itens, f, "kind", (i) => i.kind);
  return {
    total: filtrarFila(itens, f).length,
    porKind: { os: kindMap.get("os") ?? 0, ocorrencia: kindMap.get("ocorrencia") ?? 0 },
    porStatus: contarPor(itens, f, "status", (i) => (i.kind === "os" ? i.status : null)),
    porPrioridade: contarPor(itens, f, "prioridade", (i) => (i.kind === "os" ? i.prioridade : null)),
    porCategoria: contarPor(itens, f, "categoria", (i) => (i.kind === "os" ? i.categoria ?? null : null)),
    porProvedor: contarPor(itens, f, "provedorId", (i) => i.provedorId),
  };
}

export type OrdenacaoFila = "urgencia" | "recentes";

/** Data mais relevante do item, para ordenar "mais recentes primeiro". */
function dataRelevante(item: FilaItem): number {
  const iso =
    item.kind === "os"
      ? item.dataAgendamento ?? item.dataCadastro ?? item.criadoEm
      : item.dataAgendamento ?? item.dataCadastro ?? item.sincronizadoEm;
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
}

export function ordenarFila(itens: FilaItem[], modo: OrdenacaoFila): FilaItem[] {
  const copia = [...itens];
  if (modo === "recentes") {
    copia.sort((a, b) => dataRelevante(b) - dataRelevante(a));
    return copia;
  }
  // Urgência: SLA estourado primeiro; ocorrências (sem SLA) por último; empate = mais recente.
  copia.sort((a, b) => {
    const pa = a.kind === "os" ? SLA_PRIORIDADE[a.sla.semaforo] : SLA_PRIORIDADE.sem_sla;
    const pb = b.kind === "os" ? SLA_PRIORIDADE[b.sla.semaforo] : SLA_PRIORIDADE.sem_sla;
    if (pa !== pb) return pa - pb;
    return dataRelevante(b) - dataRelevante(a);
  });
  return copia;
}

export const STATUS_ORDEM: OsStatus[] = [
  OsStatus.ABERTA,
  OsStatus.EM_DESLOCAMENTO,
  OsStatus.EM_EXECUCAO,
  OsStatus.PENDENTE,
  OsStatus.CONCLUIDA,
  OsStatus.CANCELADA,
];

export { OS_STATUS_LABEL };
