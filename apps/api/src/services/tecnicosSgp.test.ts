import { describe, expect, it } from "vitest";
import { vinculoAutomatico } from "./tecnicosSgpService.js";

const tecnicos = [
  { id: "a", nome: "Alderi" },
  { id: "i", nome: "Izarleson (Major)" },
  { id: "t", nome: "Thiago Jhonatan" },
  { id: "j1", nome: "João Batista" },
];

describe("vinculo automatico tecnico do SGP -> ISPhub", () => {
  it("nome identico (sem acento, caixa e apelido) vincula", () => {
    expect(vinculoAutomatico({ nome: "alderi", username: "alderi" }, tecnicos)).toBe("a");
    expect(vinculoAutomatico({ nome: "IZARLESON", username: null }, tecnicos)).toBe("i");
  });

  it("sem nome, usa o login", () => {
    expect(vinculoAutomatico({ nome: null, username: "izarleson" }, tecnicos)).toBe("i");
  });

  it("nome diferente nao vincula: o admin decide ('JONATHAN' nao e 'Thiago Jhonatan')", () => {
    expect(vinculoAutomatico({ nome: "JONATHAN", username: "jonathan" }, tecnicos)).toBeNull();
    expect(vinculoAutomatico({ nome: "joao", username: "joao" }, tecnicos)).toBeNull();
    expect(vinculoAutomatico({ nome: "Hotspot", username: null }, tecnicos)).toBeNull();
  });

  it("dois candidatos com o mesmo nome: nao chuta", () => {
    expect(vinculoAutomatico({ nome: "Ana", username: null }, [{ id: "1", nome: "Ana" }, { id: "2", nome: "ana" }])).toBeNull();
  });

  it("sem nome nem login: nada", () => {
    expect(vinculoAutomatico({ nome: null, username: null }, tecnicos)).toBeNull();
  });
});
