import { api } from "./apiClient";
import type { PapelOcupacao } from "@isphub/shared";

/**
 * A escala do dia — quem vai em qual viatura, com quem.
 *
 * Separado de `veiculosApi` de proposito: aquele e CADASTRO de veiculo, este e
 * PLANEJAMENTO do dia. Duas perguntas diferentes, e misturar as duas faria a
 * tela de cadastro carregar dado que ela nunca usa.
 */
export interface LinhaEscala {
  id: string;
  usuarioId: string;
  nome: string;
  veiculoId: string | null;
  veiculoPlaca: string | null;
  veiculoApelido: string | null;
  papel: PapelOcupacao;
}

/** `2026-09-01` — o dia como o servidor espera (DATE, sem hora nem fuso). */
export function diaISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const escalaApi = {
  doDia: (dia: string) => api.get<LinhaEscala[]>(`/jornada/escalas?dia=${dia}`),

  escalar: (d: { usuarioId: string; dia: string; veiculoId: string | null; papel: PapelOcupacao }) =>
    api.put<LinhaEscala[]>("/jornada/escalas", d),

  desescalar: (usuarioId: string, dia: string) =>
    api.delete<LinhaEscala[]>(`/jornada/escalas/${usuarioId}?dia=${dia}`),
};
