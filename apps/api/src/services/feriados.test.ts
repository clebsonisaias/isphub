import { describe, expect, it } from "vitest";
import { domingoDePascoa, feriadoNacional, feriadosNacionais } from "@isphub/shared";

/**
 * Feriados nacionais. A parte que erra sozinha é a Páscoa — dela saem quatro
 * feriados, e é justamente ela que uma lista digitada à mão esquece.
 *
 * As datas abaixo são de calendário, conferíveis fora do código.
 */

describe("domingoDePascoa", () => {
  const conhecidas: Array<[number, string]> = [
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2030, "2030-04-21"],
    [2038, "2038-04-25"], // a mais tardia possível no ciclo
  ];
  for (const [ano, esperado] of conhecidas) {
    it(`${ano} → ${esperado}`, () => {
      expect(domingoDePascoa(ano).toISOString().slice(0, 10)).toBe(esperado);
    });
  }
});

describe("feriadosNacionais", () => {
  it("2026: os móveis saem certos a partir da Páscoa de 05/04", () => {
    const f = feriadosNacionais(2026);
    expect(f.get("2026-02-16")).toBe("Carnaval"); // segunda
    expect(f.get("2026-02-17")).toBe("Carnaval"); // terça
    expect(f.get("2026-04-03")).toBe("Sexta-feira Santa");
    expect(f.get("2026-06-04")).toBe("Corpus Christi");
  });

  it("2027 tem datas móveis DIFERENTES — é o ponto de calcular", () => {
    const f = feriadosNacionais(2027);
    expect(f.get("2027-02-08")).toBe("Carnaval");
    expect(f.get("2027-03-26")).toBe("Sexta-feira Santa");
    expect(f.get("2027-05-27")).toBe("Corpus Christi");
    // E as de 2026 não valem mais.
    expect(f.has("2026-02-16")).toBe(false);
  });

  it("os oito fixos aparecem em qualquer ano", () => {
    for (const ano of [2026, 2031, 2040]) {
      const f = feriadosNacionais(ano);
      for (const md of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"]) {
        expect(f.get(`${ano}-${md}`), `${ano}-${md}`).toBeTruthy();
      }
    }
  });

  it("cada ano tem 12 feriados (8 fixos + 4 móveis)", () => {
    expect(feriadosNacionais(2026).size).toBe(12);
  });
});

describe("feriadoNacional", () => {
  it("devolve o nome, não só um booleano — a tela diz POR QUE o dia fechou", () => {
    expect(feriadoNacional("2026-12-25")).toBe("Natal");
    expect(feriadoNacional("2026-06-04")).toBe("Corpus Christi");
  });

  it("dia comum devolve null", () => {
    expect(feriadoNacional("2026-09-10")).toBeNull();
  });

  it("em 2028 o Carnaval cai em 29 de fevereiro — e o cálculo acerta", () => {
    /*
     * Páscoa de 2028 é 16/04; a terça de Carnaval é 47 dias antes, e num ano
     * bissexto isso dá exatamente 29/02. É o caso que uma lista digitada à mão
     * erra, e o que quebraria uma aritmética de datas ingênua.
     */
    expect(feriadoNacional("2028-02-29")).toBe("Carnaval");
    expect(feriadoNacional("2028-02-28")).toBe("Carnaval");
    expect(feriadoNacional("2028-12-25")).toBe("Natal");
  });

  it("entrada inválida não quebra", () => {
    expect(feriadoNacional("nao-e-data")).toBeNull();
  });

  it("responde igual na segunda chamada (o cache não corrompe)", () => {
    expect(feriadoNacional("2026-12-25")).toBe(feriadoNacional("2026-12-25"));
  });
});
