import { colors } from "@/theme/tokens";

/**
 * Cor do sinal optico rx (dBm) da ONU. Faixa normal: -8 a -27; abaixo de -27
 * o sinal esta fraco (problema de rede/fibra). Mesma semantica de cor do SLA
 * (verde ok, ambar limite, vermelho ruim) — a unica cor forte da tela.
 */
export function corSinal(rx: number | null): string {
  if (rx == null) return colors.muted;
  if (rx >= -25 && rx <= -8) return colors.slaGreen;
  if (rx >= -28) return colors.slaAmber;
  return colors.slaRed;
}

/** Rotulo curto do sinal pra exibir junto do valor. */
export function rotuloSinal(rx: number | null): string {
  if (rx == null) return "sinal —";
  return `${rx.toFixed(1)} dBm`;
}
