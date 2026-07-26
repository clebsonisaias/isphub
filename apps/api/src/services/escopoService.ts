import { UserRole } from "@isphub/shared";
import type { JwtPayload } from "./authService.js";

/**
 * Escopo de acesso as OS por papel do usuario logado. Centraliza a regra que
 * antes estava duplicada em fila.ts, dashboard.ts e ordensServico.ts:
 * - provedor: so ve/age nas OS do proprio provedor (nunca a fila geral).
 * - tecnico: e pessoal da ISPhub (nao de um provedor especifico) — so ve/age
 *   nas OS atribuidas a ele mesmo, de qualquer provedor.
 * - admin/gestor: sem restricao (visao unificada), respeitando um filtro
 *   opcional de provedor escolhido na tela.
 */

/** Fragmento de `where` do Prisma pra listagens de OrdemServico (fila, dashboard). */
export function escopoOsWhere(user: JwtPayload, filtroProvedorId?: string): Record<string, unknown> {
  if (user.role === UserRole.PROVEDOR) {
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
  if (user.role === UserRole.PROVEDOR) return os.provedorId === user.provedorId;
  if (user.role === UserRole.TECNICO) return os.tecnicoId === user.sub;
  return true;
}
