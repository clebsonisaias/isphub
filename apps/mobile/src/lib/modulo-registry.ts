import type { ModuloId } from "@isphub/shared";

/**
 * Modulos que JA tem tela/rota implementada no app. A navegacao dinamica
 * so cria tab pra `modulo habilitado ∩ implementado` — assim um modulo ligado
 * no admin mas ainda nao construido nao vira tab morta. Cada incremento
 * adiciona sua entrada aqui.
 */
export const ROTAS_MODULO: Partial<Record<ModuloId, { rota: string }>> = {
  "minhas-os": { rota: "minhas-os" },
};
