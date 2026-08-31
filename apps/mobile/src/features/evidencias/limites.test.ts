import { describe, expect, it } from "vitest";
import { EVIDENCIA_TAMANHO_MAX_BYTES, cabeNoLimite, tamanhoBase64EmBytes } from "./limites";

describe("tamanhoBase64EmBytes", () => {
  it("conta bytes decodificados, nao caracteres", () => {
    // "AAAA" -> 3 bytes. O tamanho em caracteres (4) enganaria por 33%.
    expect(tamanhoBase64EmBytes("AAAA")).toBe(3);
  });

  it("desconta o padding", () => {
    expect(tamanhoBase64EmBytes("AAA=")).toBe(2);
    expect(tamanhoBase64EmBytes("AA==")).toBe(1);
  });

  it("trata string vazia", () => {
    expect(tamanhoBase64EmBytes("")).toBe(0);
  });
});

describe("cabeNoLimite", () => {
  it("aceita foto abaixo do limite", () => {
    expect(cabeNoLimite("A".repeat(1000))).toBe(true);
  });

  it("recusa acima do limite da API", () => {
    // 4 caracteres base64 = 3 bytes; pra estourar 2MB precisamos de mais que
    // MAX*4/3 caracteres.
    const caracteres = Math.ceil((EVIDENCIA_TAMANHO_MAX_BYTES * 4) / 3) + 8;
    expect(cabeNoLimite("A".repeat(caracteres))).toBe(false);
  });
});
