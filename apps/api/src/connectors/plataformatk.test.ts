import { describe, expect, it } from "vitest";
import { dataCompactaPtk } from "./plataformatk.js";

/**
 * O formato de data da PlataformaTK.
 *
 * Este teste existe porque o formato NAO e adivinhavel e a falha e enganosa: a
 * forma errada devolve **404**, que se le como "este rastreador nao tem
 * historico" — dado ausente, nada a fazer. So a forma certa chega na rota, e ai
 * o erro que aparece e o verdadeiro (500, do lado deles). Um refactor que
 * "normalize" isto pra ISO padrao reintroduz o 404 sem quebrar teste nenhum, a
 * menos que este exista.
 *
 * A referencia e o unico exemplo executavel da documentacao do fornecedor:
 *   /trackers/81688/history/2019-01-15T061100Z?distance=200&accuracy=medium
 */
describe("data da PlataformaTK", () => {
  it("mantém os hífens da data e tira os dois-pontos da hora", () => {
    expect(dataCompactaPtk("2019-01-15T06:11:00Z")).toBe("2019-01-15T061100Z");
  });

  it("tira os milissegundos que `toISOString()` inclui", () => {
    // `new Date().toISOString()` e a origem natural desta string no chamador.
    expect(dataCompactaPtk("2026-08-08T00:00:00.000Z")).toBe("2026-08-08T000000Z");
  });

  it("NÃO remove os hífens — sem eles a rota deixa de casar", () => {
    /*
     * Conferido contra a API de producao: `2026-08-11T000000Z` -> 500 (a rota
     * existe e o servidor deles quebra); `20260811T000000Z` -> 404 (a rota nem
     * casa). Comprimir demais parece mais limpo e e o erro oposto.
     */
    expect(dataCompactaPtk("2026-08-11T00:00:00Z")).not.toMatch(/^\d{8}T/);
    expect(dataCompactaPtk("2026-08-11T00:00:00Z")).toBe("2026-08-11T000000Z");
  });

  it("uma data já compacta passa intacta", () => {
    expect(dataCompactaPtk("2026-08-11T000000Z")).toBe("2026-08-11T000000Z");
  });
});
