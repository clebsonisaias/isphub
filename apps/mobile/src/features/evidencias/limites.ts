/**
 * Espelha EVIDENCIA_TAMANHO_MAX_BYTES da API
 * (apps/api/src/routes/ordensServico.ts:174). Duplicado de proposito: o valor
 * nao esta em @isphub/shared, e o app precisa recusar ANTES de enfileirar —
 * descobrir o estouro so na hora do envio esconderia a falha do tecnico.
 */
export const EVIDENCIA_TAMANHO_MAX_BYTES = 2 * 1024 * 1024;

export type EvidenciaMime = "image/jpeg" | "image/png" | "image/webp";

export interface EvidenciaInput {
  /** Base64 puro, sem o prefixo "data:...;base64,". */
  dados: string;
  /** Obrigatorio na API (z.enum) mesmo ela nao repassando ao SGP — omitir da 400. */
  mimeType: EvidenciaMime;
  legenda?: string;
}

/** Bytes decodificados, sem decodificar: cada 4 caracteres viram 3 bytes, menos o padding. */
export function tamanhoBase64EmBytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function cabeNoLimite(base64: string): boolean {
  return tamanhoBase64EmBytes(base64) <= EVIDENCIA_TAMANHO_MAX_BYTES;
}
