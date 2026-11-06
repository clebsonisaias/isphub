import { describe, expect, it } from "vitest";
import { escalaDaFixa, viaturaEfetiva } from "./escalaService.js";
import { decidirAplicacao } from "./viaturaFixaService.js";

const fixa = (status = "ativo", papel: "motorista" | "passageiro" = "motorista") => ({
  veiculoId: "carro-fixo",
  papel,
  veiculo: { placa: "RGI4H16", status },
});

describe("escalaDaFixa", () => {
  it("o carro fixo vira a viatura do dia, com a origem marcada", () => {
    const e = escalaDaFixa(fixa(), ["Rafael"]);
    expect(e).toMatchObject({ escalado: true, veiculoId: "carro-fixo", veiculoPlaca: "RGI4H16", fonte: "fixa" });
    expect(e.turnos).toEqual(["manha", "tarde"]);
    expect(e.parceiros).toEqual(["Rafael"]);
  });

  it("mantem o papel definido pelo gestor (ajudante = passageiro)", () => {
    expect(escalaDaFixa(fixa("ativo", "passageiro"), []).papel).toBe("passageiro");
  });

  it("carro fixo em manutencao NAO conta: o tecnico sai sem carro e o gestor escala outro", () => {
    expect(escalaDaFixa(fixa("manutencao"), []).escalado).toBe(false);
    expect(escalaDaFixa(fixa("inativo"), []).veiculoId).toBeNull();
  });

  it("com carro fixo, o que o app mandar e ignorado — so o gestor decide", () => {
    const r = viaturaEfetiva(escalaDaFixa(fixa(), []), { veiculoId: "carro-que-o-tecnico-escolheu" });
    expect(r.veiculoId).toBe("carro-fixo");
  });
});

describe("decidirAplicacao", () => {
  it("tecnico fora de turno: a troca vale a partir do proximo turno", () => {
    expect(decidirAplicacao(false, false)).toBe("sem_jornada");
  });
  it("com escala hoje, a escala vence: a troca do fixo nao mexe no turno de hoje", () => {
    expect(decidirAplicacao(true, true)).toBe("escala_hoje");
  });
  it("em turno e sem escala: move a ocupacao na hora", () => {
    expect(decidirAplicacao(true, false)).toBeNull();
  });
});
