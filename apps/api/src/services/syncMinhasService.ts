/**
 * Helpers puros do "sincronizar agora" do tecnico. A rota carrega as OS abertas
 * dele (escopo server-side) e chama syncProvedor por provedor unico, com um
 * rate-limit por usuario pra nao martelar o SGP (pull-to-refresh + botao).
 */

/** Provedores unicos das OS abertas do tecnico — dedup (varias OS por provedor). */
export function provedoresParaSincronizar(osAbertas: { provedorId: string }[]): string[] {
  return [...new Set(osAbertas.map((o) => o.provedorId))];
}

export const RATE_LIMIT_MS = 30_000;

/** true = ainda dentro da janela de rate-limit (bloquear). */
export function bloqueadoPorRate(ultimoMs: number | undefined, agoraMs: number, minMs = RATE_LIMIT_MS): boolean {
  return ultimoMs !== undefined && agoraMs - ultimoMs < minMs;
}
