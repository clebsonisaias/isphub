import { describe, expect, it } from "vitest";
import { mensagemOsNova } from "./osNovaAlertService.js";

describe("mensagemOsNova", () => {
  it("traz o TIPO junto do nome — 'chegou uma OS' nao diz o que fazer", () => {
    expect(
      mensagemOsNova({ clienteNome: "JOAO GOMES NETO", sgpOsId: "96827", tipoDescricao: "Reparo" }),
    ).toBe("Nova OS (Reparo): JOAO GOMES NETO");
  });

  it("sem tipo mapeado, ainda identifica o cliente", () => {
    // OS sem tipo continua na fila do Painel (ver equipeService) — entao ela
    // pode chegar aqui, e um aviso sem nenhuma identificacao seria inutil.
    expect(mensagemOsNova({ clienteNome: "MARIA", sgpOsId: "1", tipoDescricao: null })).toBe(
      "Nova OS: MARIA",
    );
  });

  it("sem nome do cliente, cai no numero da OS", () => {
    expect(mensagemOsNova({ clienteNome: null, sgpOsId: "96827", tipoDescricao: "Instalacao" })).toBe(
      "Nova OS (Instalacao): OS #96827",
    );
  });

  it("nome so com espacos conta como ausente", () => {
    // `??` sozinho nao pegaria: "   " e diferente de null e passaria batido,
    // produzindo "Nova OS (X):    " — um aviso sem destinatario visivel.
    expect(mensagemOsNova({ clienteNome: "   ", sgpOsId: "42", tipoDescricao: null })).toBe(
      "Nova OS: OS #42",
    );
  });
});
