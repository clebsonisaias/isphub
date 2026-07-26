import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import type { JwtPayload } from "./authService.js";
import { escopoOsWhere, podeAcessarOs } from "./escopoService.js";

function usuario(role: UserRole, overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: "user-1", email: "x@x.com", role, provedorId: null, ...overrides };
}

describe("escopoOsWhere", () => {
  it("provedor: restringe ao proprio provedorId, ignorando filtro da query", () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    expect(escopoOsWhere(u, "prov-outro")).toEqual({ provedorId: "prov-1" });
  });

  it("provedor sem provedorId cai no sentinela (nao ve a fila geral)", () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: null });
    expect(escopoOsWhere(u)).toEqual({ provedorId: "__nenhum__" });
  });

  it("tecnico: restringe as OS atribuidas a ele mesmo (sub), sem filtro de provedor", () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    expect(escopoOsWhere(u, "qualquer-provedor")).toEqual({ tecnicoId: "tec-1" });
  });

  it("admin: sem restricao, mas respeita o filtro de provedor da query se informado", () => {
    const u = usuario(UserRole.ADMIN);
    expect(escopoOsWhere(u, "prov-1")).toEqual({ provedorId: "prov-1" });
    expect(escopoOsWhere(u)).toEqual({});
  });

  it("gestor: sem restricao, mesmo comportamento do admin", () => {
    const u = usuario(UserRole.GESTOR);
    expect(escopoOsWhere(u, "prov-1")).toEqual({ provedorId: "prov-1" });
    expect(escopoOsWhere(u)).toEqual({});
  });
});

describe("podeAcessarOs", () => {
  const os = { provedorId: "prov-1", tecnicoId: "tec-1" };

  it("provedor: so acessa OS do proprio provedor", () => {
    expect(podeAcessarOs(usuario(UserRole.PROVEDOR, { provedorId: "prov-1" }), os)).toBe(true);
    expect(podeAcessarOs(usuario(UserRole.PROVEDOR, { provedorId: "prov-2" }), os)).toBe(false);
  });

  it("tecnico: so acessa OS atribuida a ele mesmo, de qualquer provedor", () => {
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-1" }), os)).toBe(true);
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-2" }), os)).toBe(false);
  });

  it("tecnico: nao acessa OS sem tecnico atribuido", () => {
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-1" }), { ...os, tecnicoId: null })).toBe(false);
  });

  it("admin/gestor: acessam qualquer OS", () => {
    expect(podeAcessarOs(usuario(UserRole.ADMIN), os)).toBe(true);
    expect(podeAcessarOs(usuario(UserRole.GESTOR), os)).toBe(true);
  });
});
