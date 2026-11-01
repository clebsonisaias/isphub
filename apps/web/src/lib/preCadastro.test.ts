import { describe, expect, it } from "vitest";
import { erroCelular, erroDocumento, erroNascimento, lerCobertura, mascararCelular, mascararCep, mascararData, mascararDocumento } from "./preCadastro";

describe("máscaras", () => {
  it("documento vira CPF ou CNPJ conforme o tamanho", () => {
    expect(mascararDocumento("52998224725")).toBe("529.982.247-25");
    expect(mascararDocumento("529982")).toBe("529.982");
    expect(mascararDocumento("12345678000190")).toBe("12.345.678/0001-90");
  });
  it("celular com 9 dígitos e fixo com 8", () => {
    expect(mascararCelular("84999991234")).toBe("(84) 99999-1234");
    expect(mascararCelular("8432101234")).toBe("(84) 3210-1234");
    expect(mascararCelular("84")).toBe("(84");
  });
  it("data e CEP enquanto digita", () => {
    expect(mascararData("10021990")).toBe("10/02/1990");
    expect(mascararData("100")).toBe("10/0");
    expect(mascararCep("59280000")).toBe("59280-000");
  });
});

describe("validação", () => {
  it("CPF confere os dígitos; CNPJ só o tamanho", () => {
    expect(erroDocumento("529.982.247-25")).toBeNull();
    expect(erroDocumento("529.982.247-24")).toMatch(/inválido/);
    expect(erroDocumento("12.345.678/0001-90")).toBeNull();
    expect(erroDocumento("123")).toMatch(/11 números/);
  });
  it("nascimento: data real e maior de idade", () => {
    const hoje = new Date("2026-11-01T12:00:00Z");
    expect(erroNascimento("10/02/1990", hoje)).toBeNull();
    expect(erroNascimento("31/02/1990", hoje)).toMatch(/não existe/);
    expect(erroNascimento("02/11/2008", hoje)).toMatch(/18 anos/);
    expect(erroNascimento("01/11/2008", hoje)).toBeNull();
    expect(erroNascimento("1990-02-10", hoje)).toMatch(/dia\/mês\/ano/);
  });
  it("celular precisa do DDD", () => {
    expect(erroCelular("(84) 99999-1234")).toBeNull();
    expect(erroCelular("99999-1234")).not.toBeNull();
  });
});

describe("lerCobertura", () => {
  it("coberto e provável deixam vender; expansão e sem cobertura não", () => {
    expect(lerCobertura({ status: "coberto", zona: { nome: "Centro" }, cidade: "Macaíba" })).toMatchObject({ pode: true, tom: "ok", detalhe: "Centro · Macaíba" });
    expect(lerCobertura({ status: "provavel" })).toMatchObject({ pode: true, tom: "atencao" });
    expect(lerCobertura({ status: "expansao" }).pode).toBe(false);
    expect(lerCobertura({ status: "sem_cobertura", zonaMaisProxima: { nome: "Vale", distanciaKm: 1.234 } }).detalhe).toContain("1,2 km");
  });
});
