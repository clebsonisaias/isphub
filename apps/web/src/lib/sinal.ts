/**
 * Faixa do sinal optico rx da ONU, em dBm: normal entre -8 e -25, limite ate
 * -28, abaixo disso e problema de fibra/rede.
 *
 * Mora aqui porque duas telas dependem da MESMA faixa (Provisionamento e a
 * ficha do SGP na OS). Duplicar os limites e como o numero de uma tela comeca
 * a discordar da outra depois de um ajuste. Espelha
 * `apps/mobile/src/features/provisionamento/sinal.ts` — mesma semantica de cor
 * do SLA (verde ok / ambar limite / vermelho ruim), a unica cor forte da tela.
 */
export function corSinal(rx: number | null): string {
  if (rx == null) return "text-muted-foreground";
  if (rx >= -25 && rx <= -8) return "text-emerald-600 dark:text-emerald-400";
  if (rx >= -28) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

/** Rotulo curto do sinal pra exibir junto do valor. */
export function rotuloSinal(rx: number | null): string {
  return rx == null ? "sinal —" : `${rx.toFixed(1)} dBm`;
}
