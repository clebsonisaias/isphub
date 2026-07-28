import type { SlaSemaforo } from "@isphub/shared";

/**
 * Design tokens do app do tecnico — claro alto-contraste (leitura sob sol), a
 * cor reservada a urgencia do SLA. Sem lib de estilo: StyleSheet + estes tokens.
 */
export const colors = {
  ground: "#EEF1F5",
  card: "#FFFFFF",
  ink: "#10151F",
  ink2: "#55606F",
  muted: "#98A1AF",
  line: "#E4E8EE",
  line2: "#D7DCE4",

  brand: "#3730A3",
  brandInk: "#2A2585",
  brandBg: "#EEEEFB",
  onBrand: "#FFFFFF",

  // Semaforo de SLA — a UNICA cor forte da fila.
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
export const radius = { sm: 8, md: 12, lg: 14, pill: 999 } as const;
export const font = {
  size: { xs: 12, sm: 13, base: 15, lg: 17, xl: 20, xxl: 24 },
  weight: { regular: "400", medium: "600", bold: "700" },
} as const;
