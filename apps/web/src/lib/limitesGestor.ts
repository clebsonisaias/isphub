import { UserRole, normalizarPermissoes, type PermissoesGestor } from "@isphub/shared";
import type { LimitesGestor } from "@/lib/adminApi";

/**
 * Limites do supervisor (GESTOR) na tela de usuários do admin. Lógica pura,
 * com teste: o resumo da lista e o que o formulário manda no PUT/POST.
 */

/** "Todos os provedores · Acesso total", "NetGo · 5 áreas". */
export function resumoLimites(
  provedoresPermitidos: string[] | undefined,
  permissoes: unknown,
  nomeProvedor: (id: string) => string,
): string {
  const provedores = provedoresPermitidos?.length ? provedoresPermitidos.map(nomeProvedor).join(", ") : "Todos os provedores";
  // Normaliza como a API: o que vem do banco pode ter área que não existe mais.
  const perm = normalizarPermissoes(permissoes ?? null);
  if (perm === null) return `${provedores} · Acesso total`;
  const n = Object.keys(perm).length;
  return `${provedores} · ${n} ${n === 1 ? "área" : "áreas"}`;
}

/**
 * O que mandar dos limites: só pra GESTOR e só o que foi mexido no formulário.
 * Campo ausente a API não toca — mandar a lista inteira sem ter mexido
 * reescreveria o que outro admin acabou de salvar.
 */
export function limitesDoFormulario(f: {
  role: UserRole;
  mexeuProvedores: boolean;
  mexeuAreas: boolean;
  provedores: string[];
  acessoTotal: boolean;
  areas: PermissoesGestor;
}): LimitesGestor {
  if (f.role !== UserRole.GESTOR) return {};
  return {
    ...(f.mexeuProvedores ? { provedoresPermitidos: f.provedores } : {}),
    ...(f.mexeuAreas ? { permissoes: f.acessoTotal ? null : f.areas } : {}),
  };
}
