import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import { saudacao, telefoneDaOs } from "./clienteAtendaiService.js";

describe("telefone do cliente da OS", () => {
  it("vira 55+DDD+numero; celular antigo ganha o 9", () => {
    expect(telefoneDaOs("(84) 99999-1234")).toBe("5584999991234");
    expect(telefoneDaOs("8488881234")).toBe("5584988881234");
    expect(telefoneDaOs("5584999991234")).toBe("5584999991234");
  });

  it("sem telefone ou numero que nao fecha: null (o botao recusa com motivo)", () => {
    expect(telefoneDaOs(null)).toBeNull();
    expect(telefoneDaOs("  ")).toBeNull();
    expect(telefoneDaOs("1234")).toBeNull();
  });
});

describe("saudacao da primeira mensagem", () => {
  it("tecnico: primeiro nome do cliente, quem fala e a OS", () => {
    expect(saudacao({ cliente: "MARIA DAS DORES", autor: "Alderi", role: UserRole.TECNICO, provedor: "NetGo", numeroOs: "213301" })).toBe(
      "Olá, Maria! Aqui é Alderi, técnico da NetGo. Falo sobre a sua ordem de serviço nº 213301.",
    );
  });

  it("atendente e sem nome do cliente", () => {
    expect(saudacao({ cliente: null, autor: "Marília", role: UserRole.ATENDENTE, provedor: "NetGo", numeroOs: null })).toBe(
      "Olá! Aqui é Marília, da NetGo.",
    );
  });
});
