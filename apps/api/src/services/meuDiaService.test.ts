import { describe, expect, it } from "vitest";
import { produtividade } from "./meuDiaService.js";

describe("produtividade", () => {
  const zero = { programadas: 0, concluidas: 0, pendentes: 0, naoRealizadas: 0 };

  it("dia vazio e 0, nao divisao por zero", () => {
    expect(produtividade(zero)).toBe(0);
  });

  it("metade concluida de um dia de 8 da 50%", () => {
    expect(produtividade({ programadas: 3, concluidas: 4, pendentes: 0, naoRealizadas: 1 })).toBe(50);
  });

  it("nao realizada CONTA no total — o numero nao pode melhorar com o fracasso", () => {
    /*
     * Este e o teste que fixa a decisao. Se "nao realizada" saisse do
     * denominador, o dia abaixo daria 100% — um tecnico que so conseguiu
     * concluir 2 de 4 apareceria como perfeito, e o indicador premiaria
     * exatamente o dia que deu errado.
     */
    const comFalha = { programadas: 0, concluidas: 2, pendentes: 0, naoRealizadas: 2 };
    expect(produtividade(comFalha)).toBe(50);
  });

  it("tudo concluido e 100%", () => {
    expect(produtividade({ ...zero, concluidas: 5 })).toBe(100);
  });
});
