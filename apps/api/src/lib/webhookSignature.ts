import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificacoes de assinatura/token dos webhooks WhatsApp — puras, sem I/O,
 * pra ficarem testaveis sem credenciais reais. `timingSafeEqual` em vez de
 * `===`: uma comparacao de string comum vaza o valor correto byte a byte por
 * timing (o loop para no primeiro byte errado); numa rota de webhook exposta
 * publicamente isso e um canal de ataque real, nao teorico.
 */

/**
 * Valida o header `X-Hub-Signature-256` da Meta: HMAC-SHA256 do corpo CRU
 * (bytes exatos, antes de qualquer parse) com o app secret, no formato
 * "sha256=<hex>". Precisa do `rawBody` capturado pelo `verify` do
 * express.json montado ANTES do parser global (ver app.ts) — o corpo
 * re-serializado nao e byte-identico ao que a Meta assinou.
 */
export function verificarAssinaturaMeta(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const assinaturaRecebida = header.slice("sha256=".length);
  const assinaturaEsperada = createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const a = Buffer.from(assinaturaRecebida, "hex");
  const b = Buffer.from(assinaturaEsperada, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Valida o header de auth configurado pra instancia Evolution (token
 * compartilhado, nao HMAC — o formato exato varia por config da instancia).
 */
export function verificarTokenEvolution(header: string | undefined, tokenEsperado: string): boolean {
  if (!header || !tokenEsperado) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(tokenEsperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
