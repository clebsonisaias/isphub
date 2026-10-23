import { UserRole, escopadoPorProvedor } from "@isphub/shared";
import { HttpError } from "../middleware/errorHandler.js";
import type { JwtPayload } from "./authService.js";

/**
 * Escopo de acesso as OS por papel do usuario logado. Centraliza a regra que
 * antes estava duplicada em fila.ts, dashboard.ts e ordensServico.ts:
 * - provedor e atendente: so ve/age nas OS do proprio provedor (nunca a fila geral).
 * - tecnico: e pessoal da ISPhub (nao de um provedor especifico) — so ve/age
 *   nas OS atribuidas a ele mesmo, de qualquer provedor.
 * - admin/gestor: sem restricao (visao unificada), respeitando um filtro
 *   opcional de provedor escolhido na tela.
 */

/** Fragmento de `where` do Prisma pra listagens de OrdemServico (fila, dashboard). */
export function escopoOsWhere(user: JwtPayload, filtroProvedorId?: string): Record<string, unknown> {
  if (escopadoPorProvedor(user.role)) {
    // Sentinela: usuario provedor sem provedorId (nao deveria acontecer) nao
    // deve cair no "sem filtro" e enxergar a fila inteira.
    return { provedorId: user.provedorId ?? "__nenhum__" };
  }
  if (user.role === UserRole.TECNICO) {
    return { tecnicoId: user.sub };
  }
  return filtroProvedorId ? { provedorId: filtroProvedorId } : {};
}

/** Confere se o usuario pode ler/agir numa OS especifica (fora de listagem). */
export function podeAcessarOs(user: JwtPayload, os: { provedorId: string; tecnicoId: string | null }): boolean {
  if (escopadoPorProvedor(user.role)) return os.provedorId === user.provedorId;
  if (user.role === UserRole.TECNICO) return os.tecnicoId === user.sub;
  return true;
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
 */
export function escopoVeiculoWhere(user: JwtPayload, filtroProvedorId?: string): Record<string, unknown> {
  if (user.role === UserRole.PROVEDOR) {
    return { provedorId: user.provedorId ?? "__nenhum__" };
  }
  if (user.role === UserRole.TECNICO) {
    return { status: { not: "inativo" } };
  }
  return filtroProvedorId ? { provedorId: filtroProvedorId } : {};
}

/** Confere se o usuario pode ler/editar um veiculo especifico. */
export function podeAcessarVeiculo(user: JwtPayload, veiculo: { provedorId: string | null }): boolean {
  if (user.role === UserRole.PROVEDOR) {
    // `null == null` seria `true` se o provedor nao tivesse provedorId — daria
    // a ele os carros da hub. A checagem explicita fecha isso.
    return veiculo.provedorId != null && veiculo.provedorId === user.provedorId;
  }
  return true;
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

  // admin/gestor: livre por desenho (despacham entre todos os provedores).
}
