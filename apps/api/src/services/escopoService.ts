import { UserRole, escopadoPorProvedor } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import type { JwtPayload } from "./authService.js";

/**
 * Escopo de acesso as OS por papel do usuario logado. Centraliza a regra que
 * antes estava duplicada em fila.ts, dashboard.ts e ordensServico.ts:
 * - provedor e atendente: so ve/age nas OS do proprio provedor (nunca a fila geral).
 * - tecnico: e pessoal da ISPhub (nao de um provedor especifico) — so ve/age
 *   nas OS em que trabalha (responsavel ou apoio), de qualquer provedor.
 * - admin/gestor: sem restricao (visao unificada), respeitando um filtro
 *   opcional de provedor escolhido na tela. O GESTOR pode ser limitado a uma
 *   lista de provedores (`Usuario.provedoresPermitidos`, vazia = todos).
 */

/** Sentinela de "nenhum provedor": casa com nada, nunca vira "sem filtro". */
const NENHUM = "__nenhum__";

/**
 * Provedores que o usuario alcanca; `null` = todos (admin, gestor sem limite,
 * tecnico — cujo escopo e por OS, nao por provedor).
 */
export function provedoresDoUsuario(user: JwtPayload): string[] | null {
  if (escopadoPorProvedor(user.role)) return [user.provedorId ?? NENHUM];
  if (user.role === UserRole.GESTOR && user.provedores?.length) return user.provedores;
  return null;
}

/**
 * Fragmento `where` por `provedorId` (OS, agendamento, pre-cadastro...).
 * `pedido` e o filtro escolhido na tela: fora do escopo vira o sentinela, nunca
 * "todos".
 */
export function filtroProvedor(user: JwtPayload, pedido?: string): Record<string, unknown> {
  const lista = provedoresDoUsuario(user);
  if (!lista) return pedido ? { provedorId: pedido } : {};
  if (pedido) return { provedorId: lista.includes(pedido) ? pedido : NENHUM };
  return { provedorId: { in: lista } };
}

export function podeProvedor(user: JwtPayload, provedorId: string): boolean {
  const lista = provedoresDoUsuario(user);
  return !lista || lista.includes(provedorId);
}

export function exigirProvedor(user: JwtPayload, provedorId: string): void {
  if (!podeProvedor(user, provedorId)) throw new HttpError(403, "Provedor fora do seu escopo");
}

/**
 * Operacao que mexe em TODOS os provedores de uma vez (robo da agenda, planilha,
 * redistribuicao do dia): quem tem escopo limitado nao dispara.
 */
export function exigirEscopoTotal(user: JwtPayload): void {
  if (provedoresDoUsuario(user)) {
    throw new HttpError(403, "Operacao afeta todos os provedores; seu acesso e limitado");
  }
}

/** Todos os agendamentos de `ids` precisam estar no escopo (lote misto = 403). */
export async function exigirAgendamentosNoEscopo(user: JwtPayload, ids: string[]): Promise<void> {
  if (!provedoresDoUsuario(user) || ids.length === 0) return;
  const unicos = [...new Set(ids)];
  const total = await prisma.agendamento.count({ where: { id: { in: unicos }, ...filtroProvedor(user) } });
  if (total !== unicos.length) throw new HttpError(403, "Agendamento fora do seu escopo");
}

/**
 * Usuarios internos (admin e gestor) que enxergam um provedor: admin sempre;
 * gestor sem lista ou com o provedor na lista.
 */
export function whereInternosDoProvedor(provedorId: string): Record<string, unknown> {
  return {
    OR: [
      { role: UserRole.ADMIN },
      {
        role: UserRole.GESTOR,
        OR: [{ provedoresPermitidos: { isEmpty: true } }, { provedoresPermitidos: { has: provedorId } }],
      },
    ],
  };
}

/**
 * OS em que o tecnico trabalha: responsavel (`tecnicoId`) OU apoio (`apoios`,
 * espelhado do despacho do SGP). Quem vai de apoio sai no mesmo carro e precisa
 * ver e agir na OS igual ao responsavel.
 *
 * Usa `OR` no topo: quem combinar com outros filtros poe isto dentro de um
 * `AND`, senao um `OR` da busca (fila.ts) sobrescreve em silencio.
 */
export function osDoTecnicoWhere(tecnicoId: string): Record<string, unknown> {
  return { OR: [{ tecnicoId }, { apoios: { some: { id: tecnicoId } } }] };
}

/**
 * Fragmento de `where` do Prisma pra listagens de OrdemServico (fila, dashboard).
 * Combinar sempre via `AND: [escopo, ...]` — o do tecnico usa `OR`.
 */
export function escopoOsWhere(user: JwtPayload, filtroProvedorId?: string): Record<string, unknown> {
  if (escopadoPorProvedor(user.role)) {
    // Sentinela: usuario provedor sem provedorId (nao deveria acontecer) nao
    // deve cair no "sem filtro" e enxergar a fila inteira.
    return { provedorId: user.provedorId ?? "__nenhum__" };
  }
  if (user.role === UserRole.TECNICO) {
    return osDoTecnicoWhere(user.sub);
  }
  return filtroProvedor(user, filtroProvedorId);
}

/**
 * Confere se o usuario pode ler/agir numa OS especifica (fora de listagem).
 * `apoios` ausente = sem apoio: quem esquecer de carregar a relacao nega, nao libera.
 */
export function podeAcessarOs(
  user: JwtPayload,
  os: { provedorId: string; tecnicoId: string | null; apoios?: { id: string }[] },
): boolean {
  if (escopadoPorProvedor(user.role)) return os.provedorId === user.provedorId;
  if (user.role === UserRole.TECNICO) {
    return os.tecnicoId === user.sub || !!os.apoios?.some((a) => a.id === user.sub);
  }
  return podeProvedor(user, os.provedorId);
}

/**
 * Escopo de VEICULO. A semantica NAO e a mesma do `escopoOsWhere`, e a
 * diferenca importa nos dois papeis:
 *
 * - PROVEDOR ve so os proprios, e NAO os de `provedorId = NULL`. Carro nulo e da
 *   operacao ISPhub e atende varios provedores — a posicao dele contaria a um
 *   ISP quando o concorrente foi atendido. Carro compartilhado e dado da hub.
 * - TECNICO ve todos os ativos, e NAO "os que ele ja ocupou": ele precisa
 *   ESCOLHER uma viatura pra declarar a ocupacao, e restringir ao historico
 *   tornaria o primeiro uso impossivel. Ele e pessoal da ISPhub, nao de um
 *   provedor — a mesma premissa que `escopoOsWhere` ja documenta.
 *
 * Ver o veiculo na lista NAO da direito a ver a TRILHA dele; aquilo e mais
 * estreito e tem guarda propria.
 *
 * GESTOR limitado ve os carros dos provedores dele E os da hub (nulos): ele
 * despacha a equipe da ISPhub, que roda nesses carros.
 */
export function escopoVeiculoWhere(user: JwtPayload, filtroProvedorId?: string): Record<string, unknown> {
  if (user.role === UserRole.PROVEDOR) {
    return { provedorId: user.provedorId ?? "__nenhum__" };
  }
  if (user.role === UserRole.TECNICO) {
    return { status: { not: "inativo" } };
  }
  if (filtroProvedorId) return filtroProvedor(user, filtroProvedorId);
  const lista = provedoresDoUsuario(user);
  return lista ? { OR: [{ provedorId: { in: lista } }, { provedorId: null }] } : {};
}

/** Confere se o usuario pode ler/editar um veiculo especifico. */
export function podeAcessarVeiculo(user: JwtPayload, veiculo: { provedorId: string | null }): boolean {
  if (user.role === UserRole.PROVEDOR) {
    // `null == null` seria `true` se o provedor nao tivesse provedorId — daria
    // a ele os carros da hub. A checagem explicita fecha isso.
    return veiculo.provedorId != null && veiculo.provedorId === user.provedorId;
  }
  return veiculo.provedorId == null || podeProvedor(user, veiculo.provedorId);
}

/**
 * Escopo de acesso as rotas POR PROVEDOR que falam ao vivo com o SGP dele
 * (conexao/*, fttx/*) — consultas de assinante e ESCRITA DE REDE (autorizar/
 * desautorizar ONU numa OLT).
 *
 * Antes, essas rotas so barravam `role=provedor`: qualquer tecnico autenticado
 * listava `GET /provedores`, pegava o id de um provedor com o qual nao tem
 * nenhuma relacao e (a) baixava a lista de assinantes dele, (b) enumerava
 * contrato por contrato pra colher endereco, ou (c) desautorizava ONUs em
 * massa — derrubando a fibra de clientes de um ISP alheio.
 *
 * A regra abaixo mantem o desenho documentado (admin/gestor sao cross-tenant
 * de proposito, e o tecnico e pessoal da ISPhub, nao de um provedor) e so
 * amarra o tecnico ao trabalho dele: ele alcanca o SGP de um provedor onde de
 * fato TEM OS atribuida. Cobre o caso real — provisionar a ONU do cliente que
 * ele esta atendendo — e fecha o resto.
 *
 * Assincrona de proposito: o vinculo do tecnico e um fato do banco, nao do JWT
 * (que e um retrato de ate 8h atras).
 */
export async function assertProvedorPermitido(
  user: JwtPayload,
  provedorId: string,
  contarOsDoTecnico: (tecnicoId: string, provedorId: string) => Promise<number>,
): Promise<void> {
  if (user.role === UserRole.PROVEDOR) {
    if (user.provedorId !== provedorId) {
      throw new HttpError(403, "Acesso restrito ao proprio provedor");
    }
    return;
  }

  if (user.role === UserRole.TECNICO) {
    const total = await contarOsDoTecnico(user.sub, provedorId);
    if (total === 0) {
      throw new HttpError(403, "Sem OS atribuida neste provedor");
    }
    return;
  }

  // admin/gestor: livres por desenho (despacham entre todos os provedores),
  // salvo o gestor limitado a uma lista.
  if (!podeProvedor(user, provedorId)) {
    throw new HttpError(403, "Provedor fora do seu escopo");
  }
}
