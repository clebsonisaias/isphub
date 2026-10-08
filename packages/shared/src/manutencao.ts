/**
 * Manutencao preventiva: quando vence, por km OU por dias — o que vier
 * primeiro. "Em breve" = faltam ate 10% do intervalo (ou 500 km / 15 dias).
 */
export type SituacaoManutencao = "ok" | "vence_em_breve" | "vencida" | "sem_base";

export interface PlanoManutencaoDto {
  id: string;
  veiculoId: string;
  tipo: string;
  intervaloKm: number | null;
  intervaloDias: number | null;
  ultimaKm: number | null;
  ultimaEm: string | null;
  ativo: boolean;
}

export interface EstadoManutencao {
  situacao: SituacaoManutencao;
  /** Km que faltam (negativo = passou). Nulo sem intervalo por km ou sem odometro. */
  restanteKm: number | null;
  /** Dias que faltam (negativo = passou). Nulo sem intervalo por dias. */
  restanteDias: number | null;
}

export function estadoManutencao(
  plano: Pick<PlanoManutencaoDto, "intervaloKm" | "intervaloDias" | "ultimaKm" | "ultimaEm">,
  odometroAtualKm: number | null,
  hoje: Date = new Date(),
): EstadoManutencao {
  let restanteKm: number | null = null;
  let restanteDias: number | null = null;
  let vencida = false;
  let emBreve = false;

  if (plano.intervaloKm != null && odometroAtualKm != null) {
    // Sem "ultima" por km, conta a partir do zero do odometro: e o que se sabe.
    restanteKm = (plano.ultimaKm ?? 0) + plano.intervaloKm - odometroAtualKm;
    if (restanteKm <= 0) vencida = true;
    else if (restanteKm <= Math.max(500, plano.intervaloKm * 0.1)) emBreve = true;
  }
  if (plano.intervaloDias != null && plano.ultimaEm) {
    const dias = Math.floor((hoje.getTime() - Date.parse(plano.ultimaEm)) / 86_400_000);
    restanteDias = plano.intervaloDias - dias;
    if (restanteDias <= 0) vencida = true;
    else if (restanteDias <= Math.max(15, plano.intervaloDias * 0.1)) emBreve = true;
  }
  if (restanteKm == null && restanteDias == null) return { situacao: "sem_base", restanteKm, restanteDias };
  return { situacao: vencida ? "vencida" : emBreve ? "vence_em_breve" : "ok", restanteKm, restanteDias };
}
