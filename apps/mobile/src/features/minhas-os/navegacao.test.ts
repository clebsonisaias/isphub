import { describe, expect, it } from "vitest";
import { linkWaze, temDestino } from "@isphub/shared";

describe("temDestino", () => {
  it("coordenada basta, inclusive zero", () => {
    expect(temDestino({ lat: 0, lng: 0 })).toBe(true);
  });
  it("qualquer pedaço de endereço basta", () => {
    expect(temDestino({ bairro: "Centro" })).toBe(true);
  });
  it("sem coordenada e sem texto não há destino", () => {
    expect(temDestino({ logradouro: "  ", cidade: null })).toBe(false);
    expect(temDestino(null)).toBe(false);
  });
  it("é exatamente o caso em que o link do Waze sairia vazio", () => {
    expect(linkWaze({})).toContain("q=&");
  });
});
