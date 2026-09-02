import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida a assinatura de um webhook vindo do AtendAI.
 *
 * O AtendAI assina o corpo CRU com HMAC-SHA256 e manda em
 * `X-AtendeHub-Signature: sha256=<hex>` (ver `jobs/webhookSaida.ts` la).
 *
 * Sem esta validacao qualquer um que descubra a URL posta mensagem no chat
 * interno da equipe — e mensagem de chat com remetente forjado e pior que
 * nenhuma mensagem.
 *
 * Sem imports do projeto de proposito: e a unica peca cujo erro tem
 * consequencia de seguranca, entao precisa ser testavel sem cerimonia.
 */
export function assinaturaConfere(corpoCru: string, cabecalho: string | undefined, segredo: string | null): boolean {
  // Sem segredo cadastrado nao ha como validar. Aceitar seria transformar
  // "ainda nao configurei" numa porta aberta.
  if (!segredo) return false;
  if (!cabecalho) return false;

  const recebida = cabecalho.startsWith("sha256=") ? cabecalho.slice(7) : cabecalho;
  const esperada = createHmac("sha256", segredo).update(corpoCru, "utf8").digest("hex");

  const a = Buffer.from(recebida, "hex");
  const b = Buffer.from(esperada, "hex");
  // Comprimentos diferentes fazem `timingSafeEqual` LANCAR, e um throw aqui
  // viraria 500 no webhook em vez de 401 — barulho no lugar de recusa limpa.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
