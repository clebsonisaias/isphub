import { z } from "zod";

/**
 * Valida uma URL admin-fornecida que o SERVIDOR vai buscar (SGP, Evolution
 * API, etc.) — bloqueia SSRF: protocolo restrito a http(s), sem
 * usuario/senha/fragmento/query embutidos (o fragmento em particular permite
 * empurrar o path que o connector concatena pra DENTRO dele), e sem
 * endereco interno/privado/link-local (a API roda dentro de um container e
 * essa URL e buscada por ela — sem isto, um admin mal-intencionado ou um
 * token vazado varre a rede interna a partir de dentro).
 *
 * Extraido do validador que ja existia so pro SGP (erpConfig.ts) — mesma
 * regra vale pra qualquer URL admin-controlada que o servidor busca.
 */
export function validarUrlExterna(valor: string, ctx: z.RefinementCtx): void {
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL invalida" });
    return;
  }

  const recusar = (motivo: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: motivo });

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    recusar("A URL precisa ser http:// ou https://");
    return;
  }
  if (u.username || u.password) recusar("Nao use usuario/senha embutidos na URL");
  if (u.hash) recusar("A URL nao pode conter fragmento (#)");
  if (u.search) recusar("A URL nao pode conter query string");

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || // link-local: metadata de nuvem
    /^f[cd][0-9a-f]{2}:/.test(host) || // IPv6 unique-local
    /^fe80:/.test(host) // IPv6 link-local
  ) {
    recusar("Endereco interno/privado nao e permitido");
  }
}
