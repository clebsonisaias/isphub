import { UserRole } from "./roles.js";

/**
 * Motor de modulos do app do tecnico (Fase 2).
 *
 * `ModuloId` e uma UNIAO FECHADA: o app tem codigo (uma feature-module) por id,
 * entao um id que o app nao conhece nao teria tela. O conjunto e fixo e vive
 * aqui, compartilhado entre API e app — o admin liga/desliga membros deste
 * conjunto, nunca inventa ids.
 */
export const MODULO_IDS = [
  "minhas-os", // CORE — fila pessoal do tecnico
  "evidencias", // camera -> proxy SGP, fila offline
  "rota", // mapa + GPS
  "conexao", // ONU rx/tx, OLT, online/offline
  "assinatura", // assinatura do cliente no fim da OS
  "retiradas", // fila de retirada/cancelamento (equipe externa)
  "notificacoes", // in-app + (depois) push
] as const;

export type ModuloId = (typeof MODULO_IDS)[number];

/**
 * Modulos que NAO podem ser desativados (login/fila sempre existem). O "core"
 * e propriedade do build, nao dado editavel — por isso vive no codigo, nao no
 * banco. `core=false` fica assim IRREPRESENTAVEL no estado persistido.
 */
export const MODULOS_CORE = ["minhas-os"] as const satisfies readonly ModuloId[];

export function isCore(id: ModuloId): boolean {
  return (MODULOS_CORE as readonly string[]).includes(id);
}

/**
 * Metadados IMUTAVEIS de um modulo — nome, icone, se e core, e os padroes de
 * lancamento (ativo/ordem/roles quando ainda nao ha registro no banco). O banco
 * (ModuloConfig) guarda so o que o admin muda; estes vivem no codigo.
 */
export interface ModuloMeta {
  id: ModuloId;
  nome: string;
  /** Chave de icone (mapeada pra um componente no app/web). */
  icone: string;
  core: boolean;
  /** Ligado no lancamento quando nao ha registro no banco? (core e sempre true.) */
  ativoPadrao: boolean;
  ordemPadrao: number;
  rolesPadrao: UserRole[];
}

export const MODULO_CATALOGO: Record<ModuloId, ModuloMeta> = {
  "minhas-os": { id: "minhas-os", nome: "Minhas OS", icone: "list", core: true, ativoPadrao: true, ordemPadrao: 0, rolesPadrao: [UserRole.TECNICO] },
  conexao: { id: "conexao", nome: "Conexão", icone: "wifi", core: false, ativoPadrao: true, ordemPadrao: 10, rolesPadrao: [UserRole.TECNICO] },
  evidencias: { id: "evidencias", nome: "Evidências", icone: "camera", core: false, ativoPadrao: true, ordemPadrao: 20, rolesPadrao: [UserRole.TECNICO] },
  rota: { id: "rota", nome: "Rota", icone: "route", core: false, ativoPadrao: true, ordemPadrao: 30, rolesPadrao: [UserRole.TECNICO] },
  notificacoes: { id: "notificacoes", nome: "Notificações", icone: "bell", core: false, ativoPadrao: true, ordemPadrao: 40, rolesPadrao: [UserRole.TECNICO] },
  assinatura: { id: "assinatura", nome: "Assinatura", icone: "signature", core: false, ativoPadrao: false, ordemPadrao: 50, rolesPadrao: [UserRole.TECNICO] },
  retiradas: { id: "retiradas", nome: "Retiradas", icone: "package-x", core: false, ativoPadrao: false, ordemPadrao: 60, rolesPadrao: [UserRole.GESTOR, UserRole.TECNICO] },
};

/** Modulo ja resolvido para um usuario (o que `GET /config` devolve). */
export interface ModuloHabilitado {
  id: ModuloId;
  nome: string;
  icone: string;
  core: boolean;
  ordem: number;
}

/** Config efetiva do app para o usuario atual. */
export interface AppConfig {
  modulos: ModuloHabilitado[];
  /** ISO — base pra cache/If-Modified e pra saber "atualizado ha X". */
  geradoEm: string;
}

/** Type guard: uma string qualquer e um ModuloId conhecido? */
export function isModuloId(v: string): v is ModuloId {
  return (MODULO_IDS as readonly string[]).includes(v);
}

/** Tipos de evento do canal realtime (SSE) — escopado por tecnico. */
export type RealtimeEventoTipo = "os-alterada" | "os-atribuida" | "os-removida" | "config-alterada";

export interface RealtimeEvento {
  tipo: RealtimeEventoTipo;
  /** OS afetada (quando aplicavel) — pra invalidar a query certa no app. */
  osId?: string;
  /** ISO. */
  em: string;
}
