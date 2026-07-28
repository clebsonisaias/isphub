import type { FilaItem, SlaInfo } from "@isphub/shared";

/** "45min" · "3h 15min" · "2d 4h" a partir de minutos. */
export function fmtDuracao(min: number): string {
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Texto do selo de SLA: estourado mostra o atraso; senao o tempo restante. */
export function textoSla(sla: SlaInfo): string {
  if (sla.semaforo === "sem_sla" || sla.minutosRestantes == null) return "Sem prazo";
  if (sla.minutosRestantes < 0) return `Estourado · ${fmtDuracao(-sla.minutosRestantes)}`;
  return fmtDuracao(sla.minutosRestantes);
}

const PESO: Record<string, number> = { vermelho: 0, amarelo: 1, verde: 2, sem_sla: 3 };

/**
 * Ordena SLA-first: mais urgente primeiro (vermelho > amarelo > verde), e dentro
 * do mesmo semaforo, menos tempo restante primeiro. Nao muta o array recebido.
 */
export function ordenarSlaFirst(itens: FilaItem[]): FilaItem[] {
  return [...itens].sort((a, b) => {
    const pa = PESO[a.sla.semaforo] ?? 3;
    const pb = PESO[b.sla.semaforo] ?? 3;
    if (pa !== pb) return pa - pb;
    return (a.sla.minutosRestantes ?? Infinity) - (b.sla.minutosRestantes ?? Infinity);
  });
}
