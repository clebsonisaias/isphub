/** Papeis de usuario no ISPhub. */
export enum UserRole {
  /** Dono/administrador: cadastra provedores, integracoes, usuarios. */
  ADMIN = "admin",
  /** Equipe interna: opera a fila unificada e despacha tecnicos. */
  GESTOR = "gestor",
  /** Tecnico de campo: executa as OS atribuidas (app mobile, Fase 2). */
  TECNICO = "tecnico",
  /** Cliente-provedor: acompanha apenas as proprias OS (portal, Fase 3). */
  PROVEDOR = "provedor",
  /**
   * Atendente do provedor: ve a fila e as OS do PROPRIO provedor e marca/
   * remarca/desmarca visitas — mais nada. Toda rota fora da lista de
   * `atendentePode` (middleware/auth.ts) responde 403 por padrao.
   */
  ATENDENTE = "atendente",
  /**
   * Vendedor do provedor, em campo: faz o pre-cadastro do cliente e agenda a
   * instalacao na hora — mais nada. Mesma negacao por padrao do atendente
   * (`vendedorPode` em middleware/auth.ts).
   */
  VENDEDOR = "vendedor",
}

export const ALL_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.GESTOR,
  UserRole.TECNICO,
  UserRole.PROVEDOR,
  UserRole.ATENDENTE,
  UserRole.VENDEDOR,
];

/** Papeis com acesso a visao unificada (todos os provedores). */
export const ROLES_INTERNOS: UserRole[] = [UserRole.ADMIN, UserRole.GESTOR];

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.ADMIN]: "Administrador",
  [UserRole.GESTOR]: "Gestor",
  [UserRole.TECNICO]: "Tecnico",
  [UserRole.PROVEDOR]: "Provedor",
  [UserRole.ATENDENTE]: "Atendente",
  [UserRole.VENDEDOR]: "Vendedor",
};

/** Papeis presos a UM provedor (provedorId obrigatorio): so enxergam o dele. */
export function escopadoPorProvedor(role: UserRole | string): boolean {
  return role === UserRole.PROVEDOR || role === UserRole.ATENDENTE || role === UserRole.VENDEDOR;
}
