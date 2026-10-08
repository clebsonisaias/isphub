import { OS_STATUS_LABEL, OsPrioridade, OsStatus, chaveVisita, compararVisita, diaBrHoje, janelaVisita, type FilaItem } from "@isphub/shared";
import { SLA_PRIORIDADE } from "@/components/SlaBadge";

/** "sem_categoria" filtra OS cujo tipo ainda nao foi mapeado a nenhuma categoria canonica. */
export type CategoriaFiltro = string | "todas" | "sem_categoria";

/**
 * Despacho: id do tecnico, ou "a_despachar" pras OS que ainda nao tem ninguem.
 *
 * "a_despachar" e a razao desta dimensao existir. Antes, saber o que faltava
 * despachar exigia varrer a lista procurando cards sem tecnico — o trabalho
 * pendente ficava misturado com o que ja esta em andamento.
 */
export type TecnicoFiltro = string | "todos" | "a_despachar";

/**
 * Visita: a marcacao da agenda ISPhub (nao a data do SGP). "hoje"/"amanha"/
 * "semana" (ate 7 dias) recortam o que ja tem dia; "sem_visita" e o que ainda
 * precisa ser marcado — a pergunta do supervisor no fim do dia.
 */
export type VisitaFiltro = "todas" | "hoje" | "amanha" | "semana" | "sem_visita";

export const VISITA_LABEL: Record<VisitaFiltro, string> = {
  todas: "Todas",
  hoje: "Hoje",
  amanha: "Amanhã",
  semana: "Esta semana",
  sem_visita: "Sem visita",
};

export interface FilaFacetState {
  status: OsStatus | "todos";
  prioridade: OsPrioridade | "todas";
  categoriaId: CategoriaFiltro;
  provedorId: string | "todos";
  tecnicoId: TecnicoFiltro;
  visita: VisitaFiltro;
  busca: string;
}

export const FILA_FACET_INICIAL: FilaFacetState = {
  status: "todos",
  prioridade: "todas",
  categoriaId: "todas",
  provedorId: "todos",
  tecnicoId: "todos",
  visita: "todas",
  busca: "",
};

export const PRIORIDADE_LABEL: Record<OsPrioridade, string> = {
  [OsPrioridade.ALTA]: "Alta",
  [OsPrioridade.NORMAL]: "Normal",
  [OsPrioridade.BAIXA]: "Baixa",
};

/** Chave de agrupamento da categoria de uma OS: id da categoria ou "sem_categoria" (tipo sem match). */
function chaveCategoria(item: FilaItem): string {
  return item.categoria?.id ?? "sem_categoria";
}

/**
 * Chave de despacho: id do tecnico ISPhub, ou "a_despachar".
 *
 * NAO usa `tecnicoSgpNome`: aquele e o pessoal do provedor anotado no SGP, nao
 * quem a operacao despachou aqui. Contar por ele diria que a OS ja tem dono
 * quando ninguem daqui foi designado — exatamente o oposto do que esta tela
 * precisa mostrar.
 */
function chaveTecnico(item: FilaItem): string {
  return item.tecnicoId ?? "a_despachar";
}

/**
 * Em que opcao da faceta "Visita" a OS cai. "semana" inclui hoje e amanha
 * (quem pede "esta semana" quer tudo ate domingo, nao so de depois de amanha).
 */
function chavesVisita(item: FilaItem, hoje: string): VisitaFiltro[] {
  if (!item.diaAgenda) return ["sem_visita"];
  const j = janelaVisita(item.diaAgenda, hoje);
  if (j === "hoje") return ["hoje", "semana"];
  if (j === "amanha") return ["amanha", "semana"];
  if (j === "semana") return ["semana"];
  return [];
}

/** Aplica um predicado por dimensão, ignorando a própria dimensão (para faceta "OR dentro, AND entre"). */
function passaStatus(item: FilaItem, f: FilaFacetState) {
  return f.status === "todos" || item.status === f.status;
}
function passaPrioridade(item: FilaItem, f: FilaFacetState) {
  return f.prioridade === "todas" || item.prioridade === f.prioridade;
}
function passaCategoria(item: FilaItem, f: FilaFacetState) {
  return f.categoriaId === "todas" || chaveCategoria(item) === f.categoriaId;
}
function passaProvedor(item: FilaItem, f: FilaFacetState) {
  return f.provedorId === "todos" || item.provedorId === f.provedorId;
}
function passaTecnico(item: FilaItem, f: FilaFacetState) {
  return f.tecnicoId === "todos" || chaveTecnico(item) === f.tecnicoId;
}
function passaVisita(item: FilaItem, f: FilaFacetState, hoje: string) {
  return f.visita === "todas" || chavesVisita(item, hoje).includes(f.visita);
}

/** Aplica todos os filtros (a busca já vem resolvida do servidor, mas mantemos por segurança). */
export function filtrarFila(itens: FilaItem[], f: FilaFacetState, hoje: string = diaBrHoje()): FilaItem[] {
  return itens.filter(
    (i) =>
      passaStatus(i, f) &&
      passaPrioridade(i, f) &&
      passaCategoria(i, f) &&
      passaProvedor(i, f) &&
      passaTecnico(i, f) &&
      passaVisita(i, f, hoje),
  );
}

/**
 * Contagem por opção de UMA dimensão, respeitando os filtros das OUTRAS
 * dimensões (contadores "vivos" como no modelo). Ex.: quantas OS de cada
 * status existem dado o provedor/categoria já filtrados.
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
    case "status":
      return "todos";
    case "prioridade":
      return "todas";
    case "categoriaId":
      return "todas";
    case "provedorId":
      return "todos";
    case "tecnicoId":
      return "todos";
    case "visita":
      return "todas";
    default:
      return "";
  }
}

/** Um tecnico com OS na fila, pra listar na barra lateral sem consultar a API. */
export interface TecnicoNaFila {
  id: string;
  nome: string;
  total: number;
}

export interface FilaFacetCounts {
  total: number;
  porStatus: Map<OsStatus, number>;
  porPrioridade: Map<OsPrioridade, number>;
  /** Chave = categoriaId, ou "sem_categoria" pras OS sem match. */
  porCategoria: Map<string, number>;
  porProvedor: Map<string, number>;
  /** Chave = tecnicoId, ou "a_despachar" pras OS sem tecnico. */
  porTecnico: Map<string, number>;
  /** Uma OS pode contar em mais de uma (hoje tambem e "esta semana"). */
  porVisita: Map<VisitaFiltro, number>;
  /**
   * Tecnicos QUE TEM OS, ja com nome resolvido e ordenados por carga.
   *
   * Sai daqui e nao de GET /tecnicos de proposito: a lista precisa refletir
   * quem tem OS no recorte atual, nao o cadastro inteiro. Um provedor com 30
   * tecnicos e 4 despachados mostraria 26 linhas zeradas.
   */
  tecnicos: TecnicoNaFila[];
}

/**
 * Lista de tecnicos presentes na fila, ordenada por carga (maior primeiro).
 *
 * Ordenar por carga e nao por nome porque a pergunta desta secao e "quem esta
 * sobrecarregado / com quem esta cada uma" — quem tem mais OS tem que aparecer
 * primeiro. Nome como desempate mantem a ordem estavel entre recargas.
 */
function listarTecnicos(itens: FilaItem[], f: FilaFacetState): TecnicoNaFila[] {
  const parcial: FilaFacetState = { ...f, tecnicoId: "todos" };
  const nomes = new Map<string, string>();
  const totais = new Map<string, number>();

  for (const i of filtrarFila(itens, parcial)) {
    if (!i.tecnicoId) continue;
    totais.set(i.tecnicoId, (totais.get(i.tecnicoId) ?? 0) + 1);
    // Sem nome no espelho, o id cru seria ilegivel — melhor um rotulo honesto.
    if (!nomes.has(i.tecnicoId)) nomes.set(i.tecnicoId, i.tecnicoNome ?? "Técnico sem nome");
  }

  return [...totais.entries()]
    .map(([id, total]) => ({ id, nome: nomes.get(id) ?? "Técnico sem nome", total }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function calcularFacetas(itens: FilaItem[], f: FilaFacetState): FilaFacetCounts {
  return {
    total: filtrarFila(itens, f).length,
    porStatus: contarPor(itens, f, "status", (i) => i.status),
    porPrioridade: contarPor(itens, f, "prioridade", (i) => i.prioridade),
    porCategoria: contarPor(itens, f, "categoriaId", chaveCategoria),
    porProvedor: contarPor(itens, f, "provedorId", (i) => i.provedorId),
    porTecnico: contarPor(itens, f, "tecnicoId", chaveTecnico),
    porVisita: contarVisita(itens, f),
    tecnicos: listarTecnicos(itens, f),
  };
}

/** Contagem da faceta "Visita" — multi-chave, por isso nao passa por `contarPor`. */
function contarVisita(itens: FilaItem[], f: FilaFacetState): Map<VisitaFiltro, number> {
  const hoje = diaBrHoje();
  const base = filtrarFila(itens, { ...f, visita: "todas" }, hoje);
  const mapa = new Map<VisitaFiltro, number>();
  for (const i of base) for (const k of chavesVisita(i, hoje)) mapa.set(k, (mapa.get(k) ?? 0) + 1);
  return mapa;
}

export type OrdenacaoFila = "urgencia" | "recentes" | "antigas" | "visita";

/** Data mais relevante da OS, para ordenar "mais recentes primeiro". */
function dataRelevante(item: FilaItem): number {
  const iso = item.dataAgendamento ?? item.dataCadastro ?? item.criadoEm;
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
}

export function ordenarFila(itens: FilaItem[], modo: OrdenacaoFila): FilaItem[] {
  const copia = [...itens];
  if (modo === "visita") {
    // A agenda manda: dia, turno, parada. Sem visita vai pro fim; dentro de
    // uma janela sem rota, a urgencia desempata — e o que o supervisor
    // olharia pra decidir a ordem de qualquer jeito.
    copia.sort((a, b) => {
      const v = compararVisita(a, b);
      if (v !== 0) return v;
      const pa = SLA_PRIORIDADE[a.sla.semaforo];
      const pb = SLA_PRIORIDADE[b.sla.semaforo];
      return pa !== pb ? pa - pb : dataRelevante(b) - dataRelevante(a);
    });
    return copia;
  }
  if (modo === "recentes") {
    copia.sort((a, b) => dataRelevante(b) - dataRelevante(a));
    return copia;
  }
  if (modo === "antigas") {
    copia.sort((a, b) => dataRelevante(a) - dataRelevante(b));
    return copia;
  }
  // Urgência: SLA estourado primeiro; empate = mais recente.
  copia.sort((a, b) => {
    const pa = SLA_PRIORIDADE[a.sla.semaforo];
    const pb = SLA_PRIORIDADE[b.sla.semaforo];
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

/**
 * Rotulo da secao quando a fila esta ordenada por visita: "Hoje · Manhã",
 * "sáb 10/10 · Tarde", "Sem visita". `chave` vem de `chaveVisita`.
 */
export function rotuloSecaoVisita(chave: string, hoje: string, rotuloDia: (dia: string) => string): string {
  if (chave === "sem_visita") return "Sem visita marcada";
  const [dia, turno] = chave.split("|");
  const j = janelaVisita(dia, hoje);
  const quando = j === "hoje" ? "Hoje" : j === "amanha" ? "Amanhã" : rotuloDia(dia);
  return `${quando} · ${turno === "manha" ? "Manhã" : "Tarde"}`;
}

export { chaveVisita };
