import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import { limitesDoFormulario, resumoLimites } from "./limitesGestor";

const nome = (id: string) => ({ p1: "NetGo", p2: "CITmax" })[id] ?? "?";

describe("resumo do gestor na lista", () => {
  it("sem limites: todos os provedores, acesso total", () => {
    expect(resumoLimites([], null, nome)).toBe("Todos os provedores · Acesso total");
    expect(resumoLimites(undefined, undefined, nome)).toBe("Todos os provedores · Acesso total");
  });

  it("com lista e áreas: nomes e contagem (área desconhecida não conta)", () => {
    expect(resumoLimites(["p1"], { fila: "ver", despacho: "editar", inventada: "editar" }, nome)).toBe("NetGo · 2 áreas");
    expect(resumoLimites(["p1", "p2"], { chat: "editar" }, nome)).toBe("NetGo, CITmax · 1 área");
    expect(resumoLimites([], {}, nome)).toBe("Todos os provedores · 0 áreas");
  });
});

describe("limites no formulário", () => {
  const base = { role: UserRole.GESTOR, mexeuProvedores: false, mexeuAreas: false, provedores: ["p1"], acessoTotal: false, areas: { fila: "ver" as const } };

  it("nada mexido: não manda nada (o PUT não apaga limite)", () => {
    expect(limitesDoFormulario(base)).toEqual({});
  });

  it("manda só o que foi mexido", () => {
    expect(limitesDoFormulario({ ...base, mexeuProvedores: true })).toEqual({ provedoresPermitidos: ["p1"] });
    expect(limitesDoFormulario({ ...base, mexeuAreas: true })).toEqual({ permissoes: { fila: "ver" } });
  });

  it("acesso total grava null", () => {
    expect(limitesDoFormulario({ ...base, mexeuAreas: true, acessoTotal: true })).toEqual({ permissoes: null });
  });

  it("papel que não é gestor nunca manda limite", () => {
    expect(limitesDoFormulario({ ...base, role: UserRole.TECNICO, mexeuProvedores: true, mexeuAreas: true })).toEqual({});
  });
});
