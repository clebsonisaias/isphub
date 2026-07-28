import { prisma } from "../lib/prisma.js";

/**
 * Estado de sessao do usuario, com cache curto em memoria.
 *
 * O problema que isto resolve: o JWT e um RETRATO do usuario no momento do
 * login (papel, provedorId), valido por ate 8h, e `requireAuth` confiava nele
 * sem nunca olhar o banco. Na pratica:
 *  - desativar um usuario nao derrubava a sessao dele;
 *  - rebaixar um admin pra tecnico deixava o token antigo passando por
 *    `requireRole(ADMIN)` — e desse token dava pra criar OUTRO admin;
 *  - trocar a senha depois de um vazamento nao invalidava o token vazado.
 *
 * A correcao e `tokenVersion`: vai no token e e conferida contra o banco. Como
 * isso seria uma consulta por request, existe este cache de TTL curto — a
 * revogacao passa a valer em segundos em vez de horas, sem transformar toda
 * rota autenticada numa ida ao banco. TTL curto tambem e o que mantem o
 * comportamento correto com mais de uma replica: cada uma expira a sua.
 */
const TTL_MS = 15_000;

export interface EstadoSessao {
  ativo: boolean;
  tokenVersion: number;
}

const cache = new Map<string, { valor: EstadoSessao | null; expiraEm: number }>();

export async function obterEstadoSessao(usuarioId: string): Promise<EstadoSessao | null> {
  const agora = Date.now();
  const emCache = cache.get(usuarioId);
  if (emCache && emCache.expiraEm > agora) return emCache.valor;

  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { ativo: true, tokenVersion: true },
  });
  const valor = usuario ? { ativo: usuario.ativo, tokenVersion: usuario.tokenVersion } : null;
  cache.set(usuarioId, { valor, expiraEm: agora + TTL_MS });
  return valor;
}

/**
 * Esquece o estado deste usuario. Chamado por quem acabou de mudar algo que
 * invalida sessao (desativar, trocar papel/provedor/senha) — assim a revogacao
 * vale IMEDIATAMENTE nesta instancia, sem esperar o TTL.
 */
export function invalidarCacheSessao(usuarioId: string): void {
  cache.delete(usuarioId);
}

/**
 * Incrementa `tokenVersion`: derruba TODA sessao existente do usuario.
 * Recebe um cliente Prisma pra poder participar de uma transacao do chamador.
 */
export async function revogarSessoes(usuarioId: string): Promise<void> {
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { tokenVersion: { increment: 1 } },
  });
  invalidarCacheSessao(usuarioId);
}
