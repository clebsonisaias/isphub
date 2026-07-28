import {
  MODULO_CATALOGO,
  MODULO_IDS,
  isCore,
  isModuloId,
  type ModuloHabilitado,
  type ModuloId,
  type UserRole,
} from "@isphub/shared";

/**
 * Motor de modulos (puro, testavel). Cruza o catalogo IMUTAVEL (codigo) com os
 * registros EDITAVEIS do banco (toggle/ordem/roles do admin) e o papel do
 * usuario, e devolve os modulos habilitados, ja ordenados. Sem I/O — a rota
 * `/config` carrega os registros e chama isto.
 */

/** Registro editavel de um modulo, como vem do banco (ModuloConfig). */
export interface ModuloConfigRow {
  moduloId: string;
  ativo: boolean;
  ordem: number;
  rolesPermitidos: string[];
}

export function montarModulosHabilitados(registros: ModuloConfigRow[], role: UserRole): ModuloHabilitado[] {
  // So registros de ids conhecidos entram (uniao fechada — ignora lixo/legado).
  const porId = new Map<ModuloId, ModuloConfigRow>();
  for (const r of registros) {
    if (isModuloId(r.moduloId)) porId.set(r.moduloId, r);
  }

  const habilitados: ModuloHabilitado[] = [];
  for (const id of MODULO_IDS) {
    const meta = MODULO_CATALOGO[id];
    const reg = porId.get(id);
    // Core e SEMPRE ativo — nenhum registro o desliga (estado ilegal
    // irrepresentavel: core nem depende do toggle).
    const ativo = isCore(id) ? true : (reg?.ativo ?? meta.ativoPadrao);
    const roles: string[] = reg?.rolesPermitidos ?? meta.rolesPadrao;
    const ordem = reg?.ordem ?? meta.ordemPadrao;
    if (!ativo) continue;
    if (!roles.includes(role)) continue;
    habilitados.push({ id, nome: meta.nome, icone: meta.icone, core: meta.core, ordem });
  }
  return habilitados.sort((a, b) => a.ordem - b.ordem);
}

/**
 * Um PATCH que tenta DESATIVAR um modulo core e invalido (core nao desliga). A
 * rota admin traduz `true` num HTTP 422. Guarda dupla: mesmo que o cliente
 * burle a UI, o servidor recusa.
 */
export function togglePatchInvalido(
  moduloId: ModuloId,
  patch: { ativo?: boolean; ordem?: number; rolesPermitidos?: string[] },
): boolean {
  return isCore(moduloId) && patch.ativo === false;
}
