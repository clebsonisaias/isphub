import { describe, expect, it } from "vitest";

/**
 * Regressao real de producao: SGP_DEBUG_RAW estava setado como "false" no
 * Coolify, mas o codigo checava `if (process.env.SGP_DEBUG_RAW)` — e toda
 * string nao-vazia e truthy em JS, entao o dump de payload bruto do SGP
 * (com nome/CPF/endereco de cliente) ficou ligado em producao vazando PII
 * pros logs do container. A flag agora passa por um parser explicito.
 */
function flagBooleana(valor: string | undefined): boolean {
  return valor?.trim().toLowerCase() === "true" || valor?.trim() === "1";
}

describe("flag booleana de ambiente", () => {
  it('trata "false" como desligado (a regressao que vazou PII em producao)', () => {
    expect(flagBooleana("false")).toBe(false);
  });

  it("trata ausencia e string vazia como desligado", () => {
    expect(flagBooleana(undefined)).toBe(false);
    expect(flagBooleana("")).toBe(false);
    expect(flagBooleana("   ")).toBe(false);
  });

  it('so liga com "true" ou "1"', () => {
    expect(flagBooleana("true")).toBe(true);
    expect(flagBooleana("TRUE")).toBe(true);
    expect(flagBooleana(" true ")).toBe(true);
    expect(flagBooleana("1")).toBe(true);
  });

  it("trata qualquer outro valor como desligado (nao adivinha intencao)", () => {
    expect(flagBooleana("0")).toBe(false);
    expect(flagBooleana("no")).toBe(false);
    expect(flagBooleana("sim")).toBe(false);
    expect(flagBooleana("off")).toBe(false);
  });
});
