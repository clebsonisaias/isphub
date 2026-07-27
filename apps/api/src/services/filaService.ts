/**
 * Mesclagem da fila unificada (Ordens de Servico + Ocorrencias) num unico
 * conjunto ordenado, com deteccao honesta de truncamento.
 *
 * Extraido de fila.ts pra ser puro e testavel: a rota busca cada tabela e
 * conta o total real no banco; esta funcao decide o que devolver e se algo
 * ficou de fora. Antes, a rota cortava cada tabela em `take: 500` e o cliente
 * filtrava provedor em memoria — com mais de um provedor, o volume passava de
 * 500 e o provedor que ordenava depois do corte sumia da tela sem aviso
 * nenhum (o contador do topo, que conta direto no banco, continuava certo,
 * escondendo o problema).
 */

/** Campos minimos que a ordenacao le — FilaItem (do @isphub/shared) os tem todos. */
export interface ItemMesclavel {
  kind: "os" | "ocorrencia";
  dataAgendamento?: string | null;
  dataCadastro?: string | null;
  criadoEm?: string | null;
}

/**
 * Data mais relevante do item pra ordenacao (mais recente primeiro). ISO em
 * texto — comparavel lexicograficamente sem parsear. Espelha a regra usada
 * na faceta do cliente (ordenarFila): OS cai pra criadoEm, ocorrencia pra
 * dataCadastro, quando nao ha agendamento.
 */
export function dataRelevante(item: ItemMesclavel): string {
  if (item.kind === "os") return item.dataAgendamento ?? item.criadoEm ?? "";
  return item.dataAgendamento ?? item.dataCadastro ?? "";
}

export interface FilaMesclada<T> {
  itens: T[];
  /** Total real no banco (soma das duas tabelas), independente do que foi buscado/coube. */
  total: number;
  /**
   * true quando o conjunto devolvido nao cobre o total real — seja porque o
   * `take` da busca cortou uma das tabelas, seja porque a mesclagem passou do
   * `limite`. O cliente deve avisar o usuario (refinar busca/filtros) em vez
   * de exibir uma lista incompleta como se fosse tudo.
   */
  truncado: boolean;
}

/**
 * Mescla e ordena OS + ocorrencias, aplica o teto defensivo e reporta se
 * algo ficou de fora.
 *
 * @param itensOs   OS ja buscadas (ate o take da rota) e mapeadas.
 * @param itensOco  Ocorrencias ja buscadas e mapeadas (vazio quando o filtro as exclui).
 * @param totalOs   Contagem real de OS no banco pro filtro atual (count, nao length).
 * @param totalOco  Contagem real de ocorrencias no banco pro filtro atual.
 * @param limite    Teto de itens devolvidos (protege payload/memoria).
 */
export function mesclarFila<T extends ItemMesclavel>(
  itensOs: T[],
  itensOco: T[],
  totalOs: number,
  totalOco: number,
  limite: number,
): FilaMesclada<T> {
  const todos = [...itensOs, ...itensOco].sort((a, b) => dataRelevante(b).localeCompare(dataRelevante(a)));
  const itens = todos.slice(0, limite);
  const total = totalOs + totalOco;
  const truncado = itens.length < total;
  return { itens, total, truncado };
}
