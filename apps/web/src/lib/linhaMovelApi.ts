import type { LinhaCandidata, TesteConexao } from "@isphub/shared";
import { api } from "./apiClient";

/**
 * Cliente da telefonia movel corporativa (Brazmovel/CITmax).
 *
 * Duas metades com riscos bem diferentes: a CREDENCIAL (o token do parceiro, que
 * enxerga a base inteira da operadora) e o VINCULO de um usuario a uma linha.
 * As duas sao ADMIN.
 */

/** O que a tela pode ver da credencial. O token NUNCA volta, nem mascarado. */
export interface ConfigLinhaMovel {
  configurada: boolean;
  baseUrl: string;
  ativo: boolean;
  ultimoTesteEm: string | null;
  ultimoTesteOk: boolean | null;
  ultimoTesteMensagem: string | null;
}

export const linhaMovelApi = {
  /** `null` quando a integração nunca foi configurada. */
  obterConfig: () => api.get<ConfigLinhaMovel | null>("/linha-movel/config"),

  salvarConfig: (dados: { baseUrl?: string; token?: string; ativo?: boolean }) =>
    api.put<ConfigLinhaMovel>("/linha-movel/config", dados),

  testar: () => api.post<TesteConexao>("/linha-movel/config/testar"),

  vinculo: (usuarioId: string) => api.get<{ vinculado: boolean }>(`/linha-movel/usuarios/${usuarioId}`),

  /**
   * Quais linhas este CPF tem?
   *
   * `nomeConfere` diz se o titular na operadora bate com o nome do cadastro. O
   * nome encontrado NÃO volta — senão esta tela viraria um jeito de descobrir de
   * quem é um CPF qualquer, e o token da operadora enxerga a base inteira.
   */
  buscar: (usuarioId: string, cpf: string) =>
    api.post<{ linhas: LinhaCandidata[]; nomeConfere: boolean }>(
      `/linha-movel/usuarios/${usuarioId}/buscar`,
      { cpf },
    ),

  vincular: (usuarioId: string, lineId: string) =>
    api.put<{ ok: true }>(`/linha-movel/usuarios/${usuarioId}`, { lineId }),

  desvincular: (usuarioId: string) => api.delete<{ ok: true }>(`/linha-movel/usuarios/${usuarioId}`),
};
