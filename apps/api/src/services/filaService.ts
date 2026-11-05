/**
 * Preparacao da fila de Ordens de Servico: ordena, aplica o teto defensivo e
 * reporta honestamente se algo ficou de fora.
 *
 * Extraido de fila.ts pra ser puro e testavel: a rota busca as OS (ate o teto)
 * e conta o total real no banco; esta funcao decide o que devolver e se algo
 * ficou de fora. Antes, a rota cortava em `take: 500` e o cliente filtrava
 * provedor em memoria depois do corte — com mais de um provedor o volume
 * passava de 500 e o provedor que ordenava depois do corte sumia da tela sem
 * aviso nenhum (o contador do topo, que conta direto no banco, continuava
 * certo, escondendo o problema).
 */

import { OsStatus, type PendentesFiltro } from "@isphub/shared";

/** Campos minimos que a ordenacao le — FilaItem (do @isphub/shared) os tem todos. */
export interface ItemOrdenavel {
  dataAgendamento?: string | null;
  criadoEm?: string | null;
}

/**
 * Data mais relevante do item pra ordenacao (mais recente primeiro). ISO em
 * texto — comparavel lexicograficamente sem parsear. Espelha a regra usada na
 * faceta do cliente (ordenarFila): cai pra criadoEm quando nao ha agendamento.
 */
export function dataRelevante(item: ItemOrdenavel): string {
  return item.dataAgendamento ?? item.criadoEm ?? "";
}

export interface FilaPreparada<T> {
  itens: T[];
  /** Total real no banco pro filtro atual, independente do que foi buscado/coube. */
  total: number;
  /**
   * true quando o conjunto devolvido nao cobre o total real — seja porque o
   * `take` da busca cortou, seja porque a lista passou do `limite`. O cliente
   * deve avisar o usuario (refinar busca/filtros) em vez de exibir uma lista
   * incompleta como se fosse tudo.
   */
  truncado: boolean;
}

/**
 * Ordena as OS (mais recentes primeiro), aplica o teto defensivo e reporta se
 * algo ficou de fora.
 *
 * @param itens  OS ja buscadas (ate o take da rota) e mapeadas.
 * @param total  Contagem real de OS no banco pro filtro atual (count, nao length).
 * @param limite Teto de itens devolvidos (protege payload/memoria).
 */
export function prepararFila<T extends ItemOrdenavel>(itens: T[], total: number, limite: number): FilaPreparada<T> {
  const ordenados = [...itens].sort((a, b) => dataRelevante(b).localeCompare(dataRelevante(a)));
  const cortados = ordenados.slice(0, limite);
  const truncado = cortados.length < total;
  return { itens: cortados, total, truncado };
}

/**
 * Recorte de OS PENDENTE na fila, ou `null` pra nao recortar. Vai no `AND` do
 * where, como o de equipe. "incluir" e o padrao: app do tecnico, Mapa,
 * Retiradas e quem mais chama /fila sem o parametro continuam iguais.
 */
export function wherePendentes(p: PendentesFiltro): Record<string, unknown> | null {
  if (p === "excluir") return { status: { not: OsStatus.PENDENTE } };
  if (p === "so") return { status: OsStatus.PENDENTE };
  return null;
}
