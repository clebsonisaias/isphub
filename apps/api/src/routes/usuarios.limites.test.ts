import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { UserRole } from "@isphub/shared";

/** Limites do supervisor no cadastro: campo ausente nao mexe; mudar derruba a sessao. */
const { mockPrisma, mockInvalidar } = vi.hoisted(() => ({
  mockPrisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    provedor: { count: vi.fn() },
  },
  mockInvalidar: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../services/sessaoService.js", () => ({ invalidarCacheSessao: mockInvalidar }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: "admin-id", role: UserRole.ADMIN };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { usuariosRouter } from "./usuarios.js";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function put(body: unknown): Promise<{ status: number }> {
  return new Promise((resolve) => {
    let status = 200;
    const req: any = { method: "PUT", url: "/g1", headers: {}, params: {}, query: {}, body };
    const res: any = {
      status: (c: number) => ((status = c), res),
      json: () => resolve({ status }),
    };
    usuariosRouter(req, res, (err: any) => resolve({ status: err?.status ?? 500 }));
  });
}

const base = { nome: "G", email: "g@x.com", role: UserRole.GESTOR, ativo: true };
const gestorLimitado = {
  id: "g1",
  ...base,
  provedorId: null,
  provedoresPermitidos: [P1],
  permissoes: { fila: "ver" },
};

describe("PUT /usuarios/:id — limites do gestor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.usuario.findUnique.mockResolvedValue(gestorLimitado);
    mockPrisma.usuario.update.mockResolvedValue({});
    mockPrisma.provedor.count.mockImplementation(async ({ where }: any) => where.id.in.length);
  });

  it("PUT so com `ativo` nao apaga os limites nem derruba a sessao", async () => {
    expect((await put(base)).status).toBe(200);
    const { data } = mockPrisma.usuario.update.mock.calls[0]![0];
    expect(data).not.toHaveProperty("provedoresPermitidos");
    expect(data).not.toHaveProperty("permissoes");
    expect(data).not.toHaveProperty("tokenVersion");
  });

  it("mudar a lista grava ordenada e derruba a sessao", async () => {
    await put({ ...base, provedoresPermitidos: [P2, P1, P2] });
    const { data } = mockPrisma.usuario.update.mock.calls[0]![0];
    expect(data.provedoresPermitidos).toEqual([P1, P2]);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(mockInvalidar).toHaveBeenCalledWith("g1");
  });

  it("mesmas permissoes em outra ordem/com lixo nao contam como mudanca", async () => {
    await put({ ...base, permissoes: { fila: "ver", inventada: "editar" } });
    const { data } = mockPrisma.usuario.update.mock.calls[0]![0];
    expect(data.permissoes).toEqual({ fila: "ver" });
    expect(data).not.toHaveProperty("tokenVersion");
  });

  it("permissoes null grava DbNull (acesso total)", async () => {
    await put({ ...base, permissoes: null });
    const { data } = mockPrisma.usuario.update.mock.calls[0]![0];
    expect(data.permissoes).toBe(Prisma.DbNull);
    expect(data.tokenVersion).toEqual({ increment: 1 });
  });

  it("deixar de ser gestor limpa os limites", async () => {
    await put({ ...base, role: UserRole.TECNICO });
    const { data } = mockPrisma.usuario.update.mock.calls[0]![0];
    expect(data.provedoresPermitidos).toEqual([]);
    expect(data.permissoes).toBe(Prisma.DbNull);
  });

  it("provedor inexistente na lista: 400", async () => {
    mockPrisma.provedor.count.mockResolvedValue(1);
    expect((await put({ ...base, provedoresPermitidos: [P1, P2] })).status).toBe(400);
    expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
  });
});
