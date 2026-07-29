import type { SlaSemaforo } from "@isphub/shared";

/**
 * Design tokens do app do tecnico. Base clara e arejada — fundo lavanda suave,
 * cards brancos com sombra difusa (levemente tintada de indigo) e cantos
 * generosos. A cor FORTE continua reservada a SEMANTICA de dado (SLA e sinal
 * optico da ONU): verde ok, ambar limite, vermelho ruim. Os acentos
 * (indigo/azul/rosa/teal) servem so pra hierarquia e estado — pill, chip, badge
 * — nunca pra colorir informacao a toa. Sem lib de estilo: StyleSheet + estes
 * tokens.
 */
export const colors = {
  // Superficies
  ground: "#F2F1FB", // lavanda bem clara (ainda ~95% de luz, legivel sob sol)
  card: "#FFFFFF",
  cardAlt: "#FAFAFE", // card levemente tintado (secoes aninhadas)

  // Tinta
  ink: "#1A1D29",
  ink2: "#5A6172",
  muted: "#9AA1B2",
  line: "#ECEBF6",
  line2: "#DEDCEF",

  // Marca — indigo vivo (pegada da referencia)
  brand: "#4F46E5",
  brandInk: "#3F37C9",
  brandBg: "#ECEBFE",
  onBrand: "#FFFFFF",

  // Acentos de hierarquia/estado (pills, chips, badges)
  blue: "#2563EB",
  blueBg: "#E7EEFE",
  pink: "#DB2777",
  pinkBg: "#FCE7F1",
  teal: "#0D9488",
  tealBg: "#D6F3EF",

  // Semaforo (SLA + sinal optico) — a UNICA cor ligada a dado
  slaRed: "#C0341D",
  slaRedBg: "#FCEBE8",
  slaAmber: "#B0700A",
  slaAmberBg: "#FBF1DF",
  slaGreen: "#0E7A45",
  slaGreenBg: "#E5F5EC",
} as const;

/** Cor forte do semaforo (rail/selo). `sem_sla` cai no neutro. */
export function corSla(semaforo: SlaSemaforo): string {
  switch (semaforo) {
    case "vermelho":
      return colors.slaRed;
    case "amarelo":
      return colors.slaAmber;
    case "verde":
      return colors.slaGreen;
    default:
      return colors.line2;
  }
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const font = {
  size: { xs: 12, sm: 13, base: 15, lg: 17, xl: 20, xxl: 24, xxxl: 28 },
  weight: { regular: "400", medium: "600", bold: "700", black: "800" },
} as const;

/**
 * Sombras difusas, de baixa opacidade e tintadas de indigo — o "brilho" premium
 * da referencia. No iOS saem coloridas e macias; no Android o `elevation` cai
 * no cinza do sistema, o que e aceitavel.
 */
export const shadow = {
  sm: { shadowColor: "#4B3FBE", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowColor: "#40369E", shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  lg: { shadowColor: "#3A3192", shadowOpacity: 0.14, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 9 },
  brand: { shadowColor: "#4F46E5", shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
} as const;
