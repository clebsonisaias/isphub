import { describe, expect, it } from "vitest";
import { deCentavos, descricaoParcela, dividirEmParcelas, paraCentavos } from "@isphub/shared";

/*
 * A SOMA TEM QUE FECHAR. R$ 100,00 em 3x da 33,3333...; arredondar cada parcela
 * pra 33,33 soma 99,99 e some um centavo. O ERP de origem trata isso — ajusta a
 * ultima parcela —, mas em float: divide, arredonda, MULTIPLICA de volta e
 * corrige a diferenca. Aqui a conta e em centavos inteiros, entao fechar nao e
 * conserto, e consequencia.
 */
describe("dividirEmParcelas", () => {
  const somaExata = (valores: string[]) => deCentavos(valores.reduce((a, v) => a + paraCentavos(v), 0));

  it("divide sem sobra", () => {
    expect(dividirEmParcelas("300.00", 3)).toEqual(["100.00", "100.00", "100.00"]);
  });

  it("joga a sobra na ULTIMA parcela", () => {
    expect(dividirEmParcelas("100.00", 3)).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("a soma bate com o total, em todos os casos dificeis", () => {
    const casos: [string, number][] = [
      ["100.00", 3],
      ["0.01", 2],
      ["0.05", 3],
      ["1000.00", 7],
      ["9999.99", 11],
      ["1234.56", 13],
      ["0.10", 3],
      ["999999999999.99", 97],
    ];
    for (const [total, n] of casos) {
      const parcelas = dividirEmParcelas(total, n);
      expect(parcelas).toHaveLength(n);
      expect(somaExata(parcelas), `${total} em ${n}x`).toBe(total);
    }
  });

  it("centavo indivisivel vai todo pra ultima", () => {
    // 1 centavo em 2x: nao da pra dar meio centavo pra cada.
    expect(dividirEmParcelas("0.01", 2)).toEqual(["0.00", "0.01"]);
  });

  it("uma parcela e o total inteiro", () => {
    expect(dividirEmParcelas("1234.56", 1)).toEqual(["1234.56"]);
  });

  it("recusa quantidade invalida", () => {
    expect(() => dividirEmParcelas("100.00", 0)).toThrow();
    expect(() => dividirEmParcelas("100.00", -1)).toThrow();
    expect(() => dividirEmParcelas("100.00", 2.5)).toThrow();
  });

  it("nunca produz parcela negativa", () => {
    for (const [total, n] of [["0.01", 5], ["0.03", 10]] as [string, number][]) {
      for (const p of dividirEmParcelas(total, n)) {
        expect(paraCentavos(p)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("descricaoParcela", () => {
  it("nomeia como a origem", () => {
    expect(descricaoParcela("Notebook", 2, 10)).toBe("Notebook (2/10)");
  });
});
