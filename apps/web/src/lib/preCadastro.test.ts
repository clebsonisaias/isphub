import { describe, expect, it } from "vitest";
import { erroCelular, erroDocumento, erroNascimento, errosCliente, faltando, lerCobertura, mesclarEndereco, mascararCelular, mascararCep, mascararData, mascararDocumento } from "./preCadastro";

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

describe("errosCliente e faltando", () => {
  const completo = {
    nome: "Maria da Silva",
    documento: "529.982.247-25",
    nascimento: "10/02/1990",
    celular: "(84) 99999-1234",
    email: "maria@exemplo.com.br",
    logradouro: "Rua das Flores",
    bairro: "Centro",
    cidade: "Macaíba",
    cep: "59280-000",
  };
  it("completo não falta nada", () => {
    expect(faltando(errosCliente(completo))).toBeNull();
  });
  it("e-mail, CEP, celular e nascimento são obrigatórios", () => {
    const e = errosCliente({ ...completo, email: "", cep: "", celular: "", nascimento: "" });
    expect(faltando(e)).toBe("nascimento, celular, e-mail e CEP");
  });
  it("CNPJ dispensa o nascimento", () => {
    expect(errosCliente({ ...completo, documento: "12.345.678/0001-90", nascimento: "" }).nascimento).toBeNull();
  });
  it("e-mail sem domínio completo é inválido", () => {
    expect(errosCliente({ ...completo, email: "maria@exemplo" }).email).toBe("E-mail inválido.");
  });
});

describe("mesclarEndereco", () => {
  const vazio = { logradouro: "", bairro: "", cidade: "", cep: "" };
  const mapa1 = { logradouro: "Rua das Flores", bairro: "Centro", cidade: "Macaíba", cep: "59280000" };

  it("formulário vazio recebe tudo do mapa, com o CEP formatado", () => {
    const r = mesclarEndereco(vazio, null, mapa1);
    expect(r.endereco).toEqual({ logradouro: "Rua das Flores", bairro: "Centro", cidade: "Macaíba", cep: "59280-000" });
    expect(r.auto).toEqual(r.endereco);
  });
  it("pino arrastado troca o que veio do mapa", () => {
    const primeiro = mesclarEndereco(vazio, null, mapa1);
    const r = mesclarEndereco(primeiro.endereco, primeiro.auto, { ...mapa1, logradouro: "Rua do Sol", cep: "59280111" });
    expect(r.endereco.logradouro).toBe("Rua do Sol");
    expect(r.endereco.cep).toBe("59280-111");
  });
  it("o que a vendedora digitou nunca é trocado", () => {
    const primeiro = mesclarEndereco(vazio, null, mapa1);
    const corrigido = { ...primeiro.endereco, logradouro: "Travessa das Flores" };
    const r = mesclarEndereco(corrigido, primeiro.auto, { ...mapa1, logradouro: "Rua do Sol" });
    expect(r.endereco.logradouro).toBe("Travessa das Flores");
    expect(r.auto.logradouro).toBeUndefined();
  });
  it("campo que o mapa não achou fica como está", () => {
    const r = mesclarEndereco({ ...vazio, cep: "59280-000" }, null, { logradouro: "Rua das Flores", cep: null });
    expect(r.endereco).toEqual({ logradouro: "Rua das Flores", bairro: "", cidade: "", cep: "59280-000" });
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
