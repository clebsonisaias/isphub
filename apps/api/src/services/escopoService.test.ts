import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import type { JwtPayload } from "./authService.js";
import { assertProvedorPermitido, escopoOsWhere, podeAcessarOs } from "./escopoService.js";

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

/**
 * Regressao de seguranca: conexao/* e fttx/* so barravam role=provedor, entao
 * qualquer tecnico autenticado alcancava o SGP de QUALQUER provedor — listava
 * assinantes, enumerava contrato por contrato e (em fttx) desautorizava ONU,
 * derrubando a fibra de clientes de um ISP com o qual nao tem relacao nenhuma.
 */
describe("assertProvedorPermitido", () => {
  const contarSempre = (n: number) => async () => n;

  it("provedor: passa no proprio", async () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    await expect(assertProvedorPermitido(u, "prov-1", contarSempre(0))).resolves.toBeUndefined();
  });

  it("provedor: barra provedor alheio", async () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    await expect(assertProvedorPermitido(u, "prov-2", contarSempre(99))).rejects.toThrow(/proprio provedor/i);
  });

  it("tecnico: BARRA provedor onde nao tem OS atribuida", async () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    await expect(assertProvedorPermitido(u, "prov-alheio", contarSempre(0))).rejects.toThrow(/sem os atribuida/i);
  });

  it("tecnico: PASSA no provedor onde tem OS atribuida (provisionar a ONU do cliente que atende)", async () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    await expect(assertProvedorPermitido(u, "prov-1", contarSempre(3))).resolves.toBeUndefined();
  });

  it("tecnico: a contagem e feita com o proprio sub e o provedor pedido", async () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    const chamadas: Array<[string, string]> = [];
    await assertProvedorPermitido(u, "prov-9", async (tecnicoId, provedorId) => {
      chamadas.push([tecnicoId, provedorId]);
      return 1;
    });
    expect(chamadas).toEqual([["tec-1", "prov-9"]]);
  });

  it("admin/gestor: livres por desenho, sem nem consultar o banco", async () => {
    let consultou = false;
    const contar = async () => {
      consultou = true;
      return 0;
    };
    for (const role of [UserRole.ADMIN, UserRole.GESTOR]) {
      await expect(assertProvedorPermitido(usuario(role), "prov-qualquer", contar)).resolves.toBeUndefined();
    }
    expect(consultou).toBe(false);
  });
});
