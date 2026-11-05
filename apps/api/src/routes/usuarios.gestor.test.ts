import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAPEIS_DA_EQUIPE, UserRole } from "@isphub/shared";

/**
 * O supervisor (GESTOR) cria e gere a propria equipe: tecnico, atendente e
 * vendedor — e, se limitado a provedores, atendente/vendedor so dos dele.
 * Admin e gestor ficam fora do alcance dele (nem listar, nem editar).
 *
 * O `requireRole` e o REAL; so o requireAuth e trocado (o req.user vem pronto).
 */
const { mockPrisma, usuario } = vi.hoisted(() => ({
  mockPrisma: {
    usuario: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    provedor: { count: vi.fn() },
  },
  usuario: { atual: {} as Record<string, unknown> },
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../services/sessaoService.js", () => ({ invalidarCacheSessao: vi.fn(), obterEstadoSessao: vi.fn() }));
vi.mock("../services/authService.js", () => ({ hashPassword: async () => "hash", verifyToken: vi.fn() }));
vi.mock("../middleware/auth.js", async () => {
  const real = await vi.importActual<typeof import("../middleware/auth.js")>("../middleware/auth.js");
  return {
    ...real,
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { ...usuario.atual };
      next();
    },
  };
});

import { usuariosRouter } from "./usuarios.js";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function chamar(method: string, url: string, body: unknown = {}): Promise<{ status: number }> {
  return new Promise((resolve) => {
    let status = 200;
    const query = Object.fromEntries(new URL(url, "http://x").searchParams);
    const req: any = { method, url, headers: {}, params: {}, query, body };
    const res: any = {
      status: (c: number) => ((status = c), res),
      json: () => resolve({ status }),
    };
    usuariosRouter(req, res, (err: any) => resolve({ status: err?.status ?? 500 }));
  });
}

const gestor = (provedores: string[] = []) => ({ sub: "g1", email: "g@x", role: UserRole.GESTOR, provedorId: null, provedores });
const novo = (role: UserRole, provedorId: string | null = null) => ({ nome: "N", email: "n@x.com", senha: "12345678", role, provedorId });
const linha = (id: string, role: UserRole, provedorId: string | null = null) => ({
  id,
  nome: id,
  email: `${id}@x.com`,
  role,
  provedorId,
  ativo: true,
  provedoresPermitidos: [],
  permissoes: null,
});

describe("/usuarios pelo gestor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuario.atual = gestor();
    mockPrisma.usuario.create.mockResolvedValue({});
    mockPrisma.usuario.update.mockResolvedValue({});
    mockPrisma.usuario.findMany.mockResolvedValue([]);
    mockPrisma.usuario.count.mockResolvedValue(1);
  });

  it("cria TECNICO", async () => {
    expect((await chamar("POST", "/", novo(UserRole.TECNICO))).status).toBe(201);
    expect(mockPrisma.usuario.create).toHaveBeenCalled();
  });

  it.each([UserRole.ADMIN, UserRole.GESTOR, UserRole.PROVEDOR])("nao cria %s", async (role) => {
    const r = await chamar("POST", "/", novo(role, role === UserRole.PROVEDOR ? P1 : null));
    expect(r.status).toBe(403);
    expect(mockPrisma.usuario.create).not.toHaveBeenCalled();
  });

  it("limitado a provedores: atendente do proprio provedor sim, de outro nao", async () => {
    usuario.atual = gestor([P1]);
    expect((await chamar("POST", "/", novo(UserRole.ATENDENTE, P1))).status).toBe(201);
    expect((await chamar("POST", "/", novo(UserRole.ATENDENTE, P2))).status).toBe(403);
    expect((await chamar("POST", "/", novo(UserRole.VENDEDOR, P2))).status).toBe(403);
    expect(mockPrisma.usuario.create).toHaveBeenCalledTimes(1);
  });

  it("nao manda limite nem num tecnico", async () => {
    expect((await chamar("POST", "/", { ...novo(UserRole.TECNICO), provedoresPermitidos: [P1] })).status).toBe(403);
    expect((await chamar("POST", "/", { ...novo(UserRole.TECNICO), permissoes: null })).status).toBe(403);
    expect(mockPrisma.usuario.create).not.toHaveBeenCalled();
  });

  it("edita tecnico; nao edita ADMIN, nao promove a GESTOR nem edita a si mesmo", async () => {
    const corpo = (role: UserRole) => ({ nome: "N", email: "n@x.com", role, provedorId: null, ativo: true });

    mockPrisma.usuario.findUnique.mockResolvedValue(linha("t1", UserRole.TECNICO));
    expect((await chamar("PUT", "/t1", corpo(UserRole.TECNICO))).status).toBe(200);
    expect((await chamar("PUT", "/t1", corpo(UserRole.GESTOR))).status).toBe(403);

    mockPrisma.usuario.findUnique.mockResolvedValue(linha("a1", UserRole.ADMIN));
    expect((await chamar("PUT", "/a1", corpo(UserRole.ADMIN))).status).toBe(403);
    expect((await chamar("PUT", "/a1", corpo(UserRole.TECNICO))).status).toBe(403);

    mockPrisma.usuario.findUnique.mockResolvedValue(linha("g1", UserRole.GESTOR));
    expect((await chamar("PUT", "/g1", corpo(UserRole.GESTOR))).status).toBe(403);

    expect(mockPrisma.usuario.update).toHaveBeenCalledTimes(1);
  });

  it("nao leva atendente pra provedor fora da lista", async () => {
    usuario.atual = gestor([P1]);
    mockPrisma.usuario.findUnique.mockResolvedValue(linha("at1", UserRole.ATENDENTE, P1));
    const r = await chamar("PUT", "/at1", { nome: "N", email: "n@x.com", role: UserRole.ATENDENTE, provedorId: P2, ativo: true });
    expect(r.status).toBe(403);
    expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
  });

  it("reseta a senha de um tecnico; a de um admin nao", async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(linha("t1", UserRole.TECNICO));
    expect((await chamar("POST", "/t1/senha", { novaSenha: "abcdefgh" })).status).toBe(200);

    mockPrisma.usuario.findUnique.mockResolvedValue(linha("a1", UserRole.ADMIN));
    expect((await chamar("POST", "/a1/senha", { novaSenha: "abcdefgh" })).status).toBe(403);
    expect(mockPrisma.usuario.update).toHaveBeenCalledTimes(1);
  });

  it("desativa tecnico; admin nao", async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(linha("t1", UserRole.TECNICO));
    expect((await chamar("DELETE", "/t1")).status).toBe(200);

    mockPrisma.usuario.findUnique.mockResolvedValue(linha("a1", UserRole.ADMIN));
    expect((await chamar("DELETE", "/a1")).status).toBe(403);
    expect(mockPrisma.usuario.update).toHaveBeenCalledTimes(1);
  });

  it("GET: so a equipe — nunca ADMIN nem GESTOR, mesmo pedindo ?role=", async () => {
    await chamar("GET", "/");
    expect(mockPrisma.usuario.findMany.mock.calls[0]![0].where).toEqual({ AND: [{}, { role: { in: PAPEIS_DA_EQUIPE } }] });
    expect(PAPEIS_DA_EQUIPE).not.toContain(UserRole.ADMIN);
    expect(PAPEIS_DA_EQUIPE).not.toContain(UserRole.GESTOR);

    // `?role=admin` so estreita: o AND com a equipe continua la (resultado vazio).
    await chamar("GET", "/?role=admin");
    expect(mockPrisma.usuario.findMany.mock.calls[1]![0].where).toEqual({
      AND: [{ role: UserRole.ADMIN }, { role: { in: PAPEIS_DA_EQUIPE } }],
    });
  });

  it("GET limitado a provedores: todo tecnico, atendente/vendedor so dos provedores dele", async () => {
    usuario.atual = gestor([P1]);
    await chamar("GET", "/");
    expect(mockPrisma.usuario.findMany.mock.calls[0]![0].where.AND[1]).toEqual({
      OR: [{ role: UserRole.TECNICO }, { role: { in: [UserRole.ATENDENTE, UserRole.VENDEDOR] }, provedorId: { in: [P1] } }],
    });
  });

  it("o admin lista sem filtro de equipe", async () => {
    usuario.atual = { sub: "a1", email: "a@x", role: UserRole.ADMIN, provedorId: null };
    await chamar("GET", "/");
    expect(mockPrisma.usuario.findMany.mock.calls[0]![0].where).toEqual({});
  });

  it.each([UserRole.TECNICO, UserRole.ATENDENTE, UserRole.PROVEDOR])("%s continua sem acesso", async (role) => {
    usuario.atual = { sub: "x", email: "x@x", role, provedorId: P1 };
    expect((await chamar("GET", "/")).status).toBe(403);
    expect((await chamar("POST", "/", novo(UserRole.TECNICO))).status).toBe(403);
  });
});
