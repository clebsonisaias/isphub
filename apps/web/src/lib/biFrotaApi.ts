import type { BiAuditoria, BiCusto, BiUso } from "@isphub/shared";
import { api } from "@/lib/apiClient";

/**
 * Cliente do BI da frota — `/frota/bi/*`, ADMIN e GESTOR.
 *
 * Separado de `veiculosApi` de proposito: aquele e CRUD de cadastro, este e
 * leitura agregada de um periodo. Misturar os dois faria a tela de cadastro
 * carregar tipos que ela nunca usa, e — pior — daria a impressao de que o BI
 * responde as mesmas perguntas do cadastro, quando ele responde outras.
 *
 * Tres chamadas e nao uma: cada bloco carrega sozinho, e uma falha em
 * `auditoria` (a mais cara) nao derruba o custo, que e o que o gestor abriu a
 * tela para ver. Mesmo padrao do Dashboard.
 */

function periodo(de: string, ate: string, provedorId?: string): string {
  const p = new URLSearchParams({ de, ate });
  if (provedorId) p.set("provedorId", provedorId);
  return `?${p.toString()}`;
}

export const biFrotaApi = {
  custo: (de: string, ate: string, provedorId?: string) =>
    api.get<BiCusto>(`/frota/bi/custo${periodo(de, ate, provedorId)}`),

  uso: (de: string, ate: string, provedorId?: string) =>
    api.get<BiUso>(`/frota/bi/uso${periodo(de, ate, provedorId)}`),

  auditoria: (de: string, ate: string, provedorId?: string) =>
    api.get<BiAuditoria>(`/frota/bi/auditoria${periodo(de, ate, provedorId)}`),
};
