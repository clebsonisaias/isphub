import { PrismaClient } from "@prisma/client";

/** Instancia unica do Prisma Client, reaproveitada em toda a API. */
export const prisma = new PrismaClient();

/**
 * Roda `fn` segurando um advisory lock do Postgres por `chave`. Se outra
 * instancia (ou outro tick) ja segura a mesma chave, NAO espera: devolve
 * `null` sem rodar `fn`. A trava e de transacao (`_xact_`), entao solta
 * sozinha no commit/rollback — inclusive se o processo morrer no meio.
 *
 * A transacao fica aberta so pra segurar a trava: `fn` usa o `prisma` normal,
 * nao o `tx`. Custo: uma conexao do pool presa enquanto `fn` roda.
 *
 * ponytail: lock por chave em transacao longa; se o pool apertar, trocar por
 * uma coluna de lease (`emAndamentoAte`) na propria tabela.
 */
export async function comTravaExclusiva<T>(
  chave: string,
  fn: () => Promise<T>,
  timeoutMs = 60 * 60 * 1000,
): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${chave})) AS ok`;
      return ok ? fn() : null;
    },
    { timeout: timeoutMs, maxWait: 5_000 },
  );
}
