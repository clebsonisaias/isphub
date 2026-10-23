import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina classes condicionais e resolve conflitos do Tailwind (padrao shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Iniciais do nome (ate 2 letras) — usado no avatar compacto do header e no chat. */
export function iniciais(nome: string): string {
  // Só palavras que começam com letra: "Anna Clara (AtendAI)" vira "AC", não "A(".
  const partes = nome.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  if (partes.length === 0) return nome.trim()[0]?.toUpperCase() ?? "?";
  const letras =
    partes.length > 1
      ? [partes[0][0], partes[partes.length - 1][0]]
      : [partes[0]?.[0] ?? "?"];
  return letras.join("").toUpperCase();
}
