import { UserRole, type EquipeFiltro } from "@isphub/shared";

/**
 * Recorte de "quem executa a OS". Retirada/cancelamento e feita por equipes de
 * fora, nao pela equipe da ISPhub — misturar as duas na mesma fila fazia o
 * painel cobrar da equipe um trabalho que nao e dela.
 *
 * Por que OR explicito e nao `NOT: { tipoOs: { categoria: { equipeExterna: true } } }`:
 * `tipoOsId` e `TipoOs.categoriaId` sao nullable. Filtro negado sobre relacao
 * opcional vira, no SQL, a negacao de um `IN (subquery)` — e `NULL IN (...)` e
 * NULL, entao `NOT (NULL)` tambem e NULL e a linha e DESCARTADA. OS sem tipo
 * mapeado sumiria da fila principal em silencio (o mesmo tipo de bug do corte
 * cego de 500 que ja escondeu dados neste repo). O OR abaixo diz exatamente o
 * que queremos sem depender de como a versao do Prisma compila a negacao.
 */
export const OS_INTERNA_WHERE: Record<string, unknown> = {
  OR: [
    { tipoOsId: null },
    { tipoOs: { categoriaId: null } },
    { tipoOs: { categoria: { equipeExterna: false } } },
  ],
};

/** Filtro positivo: atravessa relacao nullable sem ambiguidade (quem nao tem
 *  tipo/categoria simplesmente nao casa, sem precisar negar nada). */
export const OS_EXTERNA_WHERE: Record<string, unknown> = {
  tipoOs: { categoria: { equipeExterna: true } },
};

/**
 * Fragmento de `where` do Prisma pra listagens/agregacoes de OrdemServico, ou
 * `null` pra "todas" (nenhuma condicao — escape hatch de auditoria, nao
 * exposto na UI). Some sempre no `AND` (array) do chamador, nunca no topo do
 * `where` — `OR` (busca) e `tipoOs` (filtro de categoria) ja sao usados por
 * outras dimensoes do filtro e um `where.OR`/`where.tipoOs` direto os
 * sobrescreveria em silencio.
 */
export function whereEquipeOs(equipe: EquipeFiltro): Record<string, unknown> | null {
  if (equipe === "interna") return OS_INTERNA_WHERE;
  if (equipe === "externa") return OS_EXTERNA_WHERE;
  return null;
}

/**
 * Mesma coisa, mas ciente de QUEM pergunta — e e por aqui que as rotas devem
 * entrar.
 *
 * O recorte de equipe existe pras filas DA HUB (Painel, Mapa, Retiradas): sem
 * ele o painel cobrava da equipe interna um trabalho que e de equipe externa.
 * Numa fila ja escopada a UMA PESSOA (`escopoOsWhere` fixa `tecnicoId`), a
 * pergunta e outra — "o que foi atribuido a mim?" — e a resposta nao pode
 * depender da categoria da OS. Se me deram, e minha.
 *
 * Sem esta excecao, uma OS de retirada atribuida a um tecnico SUMIA da lista
 * dele: `atribuirTecnico` (writebackService.ts) nao olha equipe nenhuma e cria
 * a notificacao normalmente, entao ele era avisado de uma OS que a tela nao
 * mostrava. Dispensou a notificacao, perdeu a OS — sem erro, sem rastro.
 */
export function whereEquipeParaUsuario(equipe: EquipeFiltro, role: UserRole): Record<string, unknown> | null {
  if (role === UserRole.TECNICO) return null;
  return whereEquipeOs(equipe);
}
