import { describe, expect, it } from "vitest";
import { efeitoDe, ehPreferencia, type PreferenciaAcesso } from "./preferencia-acesso";

describe("efeitoDe", () => {
  it("biometria guarda tudo e pede a digital", () => {
    expect(efeitoDe("biometria")).toEqual({ guardaSessao: true, guardaEmail: true, pedeBiometria: true });
  });

  it("email lembra so o e-mail — a sessao NAO fica no aparelho", () => {
    // E o caso do celular compartilhado: some o trabalho de digitar o e-mail,
    // sem deixar a sessao de ninguem aberta pro proximo que pegar o aparelho.
    expect(efeitoDe("email")).toEqual({ guardaSessao: false, guardaEmail: true, pedeBiometria: false });
  });

  it("NADA nao guarda sessao — esta e a unica assercao com consequencia de privacidade", () => {
    // Se um dia alguem "otimizar" isto pra guardar a sessao mesmo assim, o
    // botao passa a mentir: o proximo que pegar o aparelho entra como o dono.
    expect(efeitoDe("nada").guardaSessao).toBe(false);
    expect(efeitoDe("nada").guardaEmail).toBe(false);
    expect(efeitoDe("nada").pedeBiometria).toBe(false);
  });

  it("so biometria pede biometria", () => {
    const todas: PreferenciaAcesso[] = ["biometria", "email", "nada"];
    expect(todas.filter((p) => efeitoDe(p).pedeBiometria)).toEqual(["biometria"]);
  });
});

describe("ehPreferencia", () => {
  it("aceita as tres e recusa o resto", () => {
    expect(["biometria", "email", "nada"].every(ehPreferencia)).toBe(true);
    for (const lixo of [null, undefined, "", "1", "sim", "BIOMETRIA"]) {
      expect(ehPreferencia(lixo)).toBe(false);
    }
  });
});
