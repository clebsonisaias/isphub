import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@isphub/shared";
import type { JwtPayload } from "./authService.js";

/**
 * Regressao de seguranca do chat com clientes: o modulo so barrava o papel
 * PROVEDOR e nenhuma rota conferia se a conversa era do usuario — qualquer
 * TECNICO lia, respondia, assumia e encerrava a conversa de qualquer outro, e
 * `GET /conversas` sem filtro devolvia a caixa inteira. As funcoes abaixo sao a
 * unica fonte dessa regra; se um teste daqui cair, o vazamento voltou.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
// So o guard toca o banco; mockar o client mantem estes testes puros como os
// demais do repo (nao ha infra de banco em teste aqui).
vi.mock("../lib/prisma.js", () => ({ prisma: { conversaCliente: { findUnique } } }));

const { escopoConversaClienteWhere, exigirAcessoConversaCliente, podeAcessarConversaCliente, whereConversasCliente } =
  await import("./clienteChatService.js");

function usuario(role: UserRole, overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: "user-1", email: "x@x.com", role, provedorId: null, ...overrides };
}

describe("escopoConversaClienteWhere", () => {
  it("admin/gestor: sem restricao (veem a caixa inteira)", () => {
    expect(escopoConversaClienteWhere(usuario(UserRole.ADMIN))).toEqual({});
    expect(escopoConversaClienteWhere(usuario(UserRole.GESTOR))).toEqual({});
  });

  it("tecnico: so o que ele mesmo iniciou — a chave e iniciadaPorId, nao agenteId", () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    expect(escopoConversaClienteWhere(u)).toEqual({ iniciadaPorId: "tec-1" });
  });

  it("provedor: cai no sentinela, nunca no where vazio", () => {
    expect(escopoConversaClienteWhere(usuario(UserRole.PROVEDOR, { provedorId: "prov-1" }))).toEqual({ iniciadaPorId: "__nenhum__" });
  });
});

describe("podeAcessarConversaCliente", () => {
  const doTecnico1 = { iniciadaPorId: "tec-1" };
  const entrante = { iniciadaPorId: null };

  it("admin/gestor: acessam qualquer conversa (e o que permite intervir)", () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR]) {
      expect(podeAcessarConversaCliente(usuario(role), doTecnico1)).toBe(true);
      expect(podeAcessarConversaCliente(usuario(role), entrante)).toBe(true);
    }
  });

  it("tecnico: so a que ele iniciou", () => {
    expect(podeAcessarConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), doTecnico1)).toBe(true);
    expect(podeAcessarConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-2" }), doTecnico1)).toBe(false);
  });

  it("tecnico: nao acessa conversa entrante (a fila nao e dele)", () => {
    expect(podeAcessarConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), entrante)).toBe(false);
  });

  it("provedor: barrado mesmo se o sub casasse com iniciadaPorId", () => {
    expect(podeAcessarConversaCliente(usuario(UserRole.PROVEDOR, { sub: "tec-1" }), doTecnico1)).toBe(false);
  });
});

describe("whereConversasCliente (o filtro da tela so estreita)", () => {
  it("admin com `todas`: sem restricao alem das nao arquivadas", () => {
    expect(whereConversasCliente(usuario(UserRole.ADMIN), "todas")).toEqual({ arquivada: false });
  });

  it("tecnico com `todas`: NAO alarga — o escopo continua colado", () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    expect(whereConversasCliente(u, "todas")).toEqual({ arquivada: false, iniciadaPorId: "tec-1" });
  });

  it("tecnico com `fila`: escopo + sem agente — nunca a fila geral", () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    expect(whereConversasCliente(u, "fila")).toEqual({ arquivada: false, iniciadaPorId: "tec-1", agenteId: null });
  });

  it("`minhas` estreita por agenteId para qualquer papel", () => {
    expect(whereConversasCliente(usuario(UserRole.GESTOR, { sub: "ges-1" }), "minhas")).toEqual({ arquivada: false, agenteId: "ges-1" });
    expect(whereConversasCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), "minhas")).toEqual({
      arquivada: false,
      iniciadaPorId: "tec-1",
      agenteId: "tec-1",
    });
  });

  it("provedor: o sentinela sobrevive a qualquer filtro", () => {
    for (const filtro of ["fila", "minhas", "todas"] as const) {
      expect(whereConversasCliente(usuario(UserRole.PROVEDOR), filtro)).toMatchObject({ iniciadaPorId: "__nenhum__" });
    }
  });
});

describe("exigirAcessoConversaCliente", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("conversa inexistente -> 404", async () => {
    findUnique.mockResolvedValue(null);
    await expect(exigirAcessoConversaCliente(usuario(UserRole.ADMIN), "c-1")).rejects.toMatchObject({ status: 404 });
  });

  it("tecnico em conversa alheia -> 403", async () => {
    findUnique.mockResolvedValue({ id: "c-1", iniciadaPorId: "tec-2", agenteId: "tec-2" });
    await expect(exigirAcessoConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), "c-1")).rejects.toMatchObject({ status: 403 });
  });

  it("tecnico em conversa entrante (da fila) -> 403", async () => {
    findUnique.mockResolvedValue({ id: "c-1", iniciadaPorId: null, agenteId: null });
    await expect(exigirAcessoConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), "c-1")).rejects.toMatchObject({ status: 403 });
  });

  it("tecnico na propria -> passa e devolve a conversa carregada", async () => {
    const conversa = { id: "c-1", iniciadaPorId: "tec-1", agenteId: "tec-1" };
    findUnique.mockResolvedValue(conversa);
    await expect(exigirAcessoConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), "c-1")).resolves.toBe(conversa);
  });

  it("tecnico continua dono da conversa que iniciou mesmo depois de transferida", async () => {
    findUnique.mockResolvedValue({ id: "c-1", iniciadaPorId: "tec-1", agenteId: "tec-9" });
    await expect(exigirAcessoConversaCliente(usuario(UserRole.TECNICO, { sub: "tec-1" }), "c-1")).resolves.toMatchObject({ id: "c-1" });
  });

  it("admin/gestor passam em conversa de outro atendente — e o que habilita a intervencao", async () => {
    findUnique.mockResolvedValue({ id: "c-1", iniciadaPorId: "tec-2", agenteId: "tec-2" });
    for (const role of [UserRole.ADMIN, UserRole.GESTOR]) {
      await expect(exigirAcessoConversaCliente(usuario(role), "c-1")).resolves.toMatchObject({ id: "c-1" });
    }
  });

  it("provedor -> 403 mesmo na conversa que teria o sub dele", async () => {
    findUnique.mockResolvedValue({ id: "c-1", iniciadaPorId: "user-1", agenteId: null });
    await expect(exigirAcessoConversaCliente(usuario(UserRole.PROVEDOR), "c-1")).rejects.toMatchObject({ status: 403 });
  });
});
