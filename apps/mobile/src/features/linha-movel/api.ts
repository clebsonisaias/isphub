import type { LinhaMovel } from "@isphub/shared";
import { apiFetch } from "@/lib/api";

/**
 * Os quatro estados sao distintos de proposito.
 *
 * "Nao ha integracao", "seu CPF ainda nao foi vinculado" e "a linha vinculada
 * sumiu" tem causas e solucoes diferentes — e virariam a mesma tela vazia se
 * fossem um estado so.
 */
export type MinhaLinha =
  | { estado: "sem_integracao" }
  | { estado: "sem_vinculo" }
  | { estado: "nao_encontrada" }
  | { estado: "ok"; linha: LinhaMovel };

/**
 * A linha do usuario autenticado.
 *
 * **Sem parametro nenhum, e isso e a garantia.** O servidor resolve qual linha
 * pelo token; nao ha onde escrever "a linha do fulano". Se um dia alguem
 * acrescentar um argumento aqui, esta ausencia deixou de ser a protecao.
 */
export function buscarMinhaLinha(token: string | null): Promise<MinhaLinha> {
  return apiFetch<MinhaLinha>("/linha-movel/minha", { token });
}
