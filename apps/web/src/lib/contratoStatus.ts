/**
 * O contrato desta OS está em situação que impede/atrapalha o atendimento?
 *
 * `contratoStatus` é TEXTO CRU do SGP — não há enum nem normalizador do lado
 * do ERP, e o rótulo varia por instância ("Ativo", "Cancelado", "Suspenso",
 * "Ativo V. Reduzida", "Contrato Inativo"). Por isso a regra é por exclusão:
 * "ativo" é o único valor normal, e qualquer outro (inclusive um que ainda não
 * conhecemos) vira alerta. Errar pro lado de alertar é barato; errar pro outro
 * lado manda técnico a uma casa onde o serviço não deveria acontecer.
 *
 * "Ativo V. Reduzida" (inadimplência) conta como problema DE PROPÓSITO: o
 * cliente está conectado, mas quem vai despachar precisa saber.
 *
 * Status ausente devolve `false` — não dá pra afirmar que há problema, e um
 * alerta falso em toda OS sem esse campo destruiria a confiança no sinal.
 *
 * Vive aqui, e não dentro do badge, porque o mapa e o card precisam da MESMA
 * resposta: divergir faria o pino dizer "ok" e o popup dizer "Contrato
 * Cancelado" na mesma OS.
 */
export function contratoTemProblema(status?: string | null): boolean {
  if (!status) return false;
  return status.trim().toLowerCase() !== "ativo";
}
