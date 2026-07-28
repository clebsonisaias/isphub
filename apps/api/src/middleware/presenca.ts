import { prisma } from "../lib/prisma.js";

const ultimoToqueMs = new Map<string, number>();
const THROTTLE_MS = 60_000;

/**
 * Atualiza Usuario.ultimaAtividadeEm no maximo 1x/60s por usuario (Map em
 * memoria, mesmo espirito do realtimeHub) — presenca "online" barata em
 * qualquer request autenticado, sem bater no banco toda hora. Fire-and-forget:
 * nunca atrasa nem derruba a resposta por causa disso.
 */
export function tocarPresenca(usuarioId: string): void {
  const agora = Date.now();
  const ultimo = ultimoToqueMs.get(usuarioId);
  if (ultimo && agora - ultimo < THROTTLE_MS) return;
  ultimoToqueMs.set(usuarioId, agora);
  prisma.usuario.update({ where: { id: usuarioId }, data: { ultimaAtividadeEm: new Date() } }).catch(() => {
    // best-effort — presenca nunca deve derrubar um request
  });
}
