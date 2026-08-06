import { describe, expect, it } from "vitest";
import {
  consumoPorAbastecimento,
  formatarConsumo,
  sinalDoMovimento,
  type AbastecimentoBase,
} from "@isphub/shared";

/*
 * CONSUMO SO SE MEDE DE TANQUE CHEIO A TANQUE CHEIO.
 *
 * Num abastecimento parcial nao se sabe quanto havia no tanque, entao a
 * distancia percorrida nao corresponde aos litros postos. Calcular assim mesmo
 * produz um km/l plausivel e errado — que num painel de custo vira decisao
 * errada. `null` e a resposta honesta.
 */
describe("consumoPorAbastecimento", () => {
  const cheio = (km: number, litros: string): AbastecimentoBase => ({ km, litros, tanqueCheio: true });
  const parcial = (km: number, litros: string): AbastecimentoBase => ({ km, litros, tanqueCheio: false });

  it("o primeiro abastecimento nunca tem consumo", () => {
    // Sem km anterior nao ha distancia percorrida pra dividir.
    expect(consumoPorAbastecimento([cheio(1000, "40")])).toEqual([null]);
  });

  it("dois cheios: distancia dividida pelos litros do SEGUNDO", () => {
    // 1400-1000 = 400 km com os 40 L do segundo enchimento = 10 km/l.
    expect(consumoPorAbastecimento([cheio(1000, "50"), cheio(1400, "40")])).toEqual([null, 10]);
  });

  it("parcial no meio nao fecha intervalo, mas os litros contam", () => {
    /*
     * 1000 (cheio) -> 1200 (parcial, 20 L) -> 1500 (cheio, 30 L).
     * O intervalo valido e 1000->1500 = 500 km, com 20+30 = 50 L => 10 km/l.
     * Ignorar os 20 L parciais daria 500/30 = 16,7 — um consumo inventado.
     */
    const r = consumoPorAbastecimento([cheio(1000, "40"), parcial(1200, "20"), cheio(1500, "30")]);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull(); // parcial nunca tem consumo proprio
    expect(r[2]).toBe(10);
  });

  it("dois parciais seguidos acumulam ate o proximo cheio", () => {
    const r = consumoPorAbastecimento([
      cheio(0, "10"),
      parcial(100, "5"),
      parcial(200, "5"),
      cheio(300, "20"),
    ]);
    expect(r[3]).toBe(300 / 30); // 300 km com 5+5+20 = 30 L
  });

  it("odometro que nao andou nao vira divisao por zero nem consumo zero", () => {
    expect(consumoPorAbastecimento([cheio(1000, "40"), cheio(1000, "40")])).toEqual([null, null]);
  });

  it("odometro que ANDOU PRA TRAS e recusado, nao vira negativo", () => {
    // Troca de veiculo, erro de digitacao ou painel trocado — um km/l negativo
    // num relatorio e pior que um traco.
    expect(consumoPorAbastecimento([cheio(2000, "40"), cheio(1000, "40")])[1]).toBeNull();
  });

  it("a ordem da entrada nao muda o resultado", () => {
    // A conta pressupoe ordem de odometro; a lista pode chegar por data.
    const emOrdem = [cheio(1000, "40"), cheio(1400, "40")];
    const fora = [cheio(1400, "40"), cheio(1000, "40")];
    expect(consumoPorAbastecimento(fora)).toEqual([10, null]);
    expect(consumoPorAbastecimento(emOrdem)).toEqual([null, 10]);
  });

  it("lista vazia nao quebra", () => {
    expect(consumoPorAbastecimento([])).toEqual([]);
  });
});

describe("formatarConsumo", () => {
  it("uma casa decimal, virgula, e traco quando nao ha o que afirmar", () => {
    expect(formatarConsumo(12.34)).toBe("12,3 km/l");
    expect(formatarConsumo(null)).toBe("—");
  });
});

describe("sinalDoMovimento", () => {
  it("so consumo subtrai", () => {
    expect(sinalDoMovimento("deposito")).toBe(1);
    expect(sinalDoMovimento("estorno")).toBe(1);
    expect(sinalDoMovimento("consumo")).toBe(-1);
  });
});
