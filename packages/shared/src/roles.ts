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
}

export const ALL_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.GESTOR,
  UserRole.TECNICO,
  UserRole.PROVEDOR,
];

/** Papeis com acesso a visao unificada (todos os provedores). */
export const ROLES_INTERNOS: UserRole[] = [UserRole.ADMIN, UserRole.GESTOR];

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.ADMIN]: "Administrador",
  [UserRole.GESTOR]: "Gestor",
  [UserRole.TECNICO]: "Tecnico",
  [UserRole.PROVEDOR]: "Provedor",
};
