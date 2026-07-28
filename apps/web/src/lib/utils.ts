import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina classes condicionais e resolve conflitos do Tailwind (padrao shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Iniciais do nome (ate 2 letras) — usado no avatar compacto do header e no chat. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const letras =
    partes.length > 1
      ? [partes[0][0], partes[partes.length - 1][0]]
      : [partes[0]?.[0] ?? "?"];
  return letras.join("").toUpperCase();
}
