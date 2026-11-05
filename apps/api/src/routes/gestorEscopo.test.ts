import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "express";
import { UserRole } from "@isphub/shared";

/**
 * Gestor limitado a provedores, nas rotas que nao passam so pelo escopoService.
 * `requireRole` e o real; o `requireAuth` injeta o usuario como o real faria
 * (a lista `provedores` vem do banco, nunca do token).
 */
const { mockPrisma, mockAgenda, usuario } = vi.hoisted(() => ({
  mockPrisma: {
    provedor: { findMany: vi.fn() },
    agendamento: { count: vi.fn() },
  },
  mockAgenda: { marcar: vi.fn(), definirRota: vi.fn(), doTurno: vi.fn(), enviarAoSgp: vi.fn() },
  usuario: { atual: {} as Record<string, unknown> },
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../services/agendaService.js", () => mockAgenda);
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

import { provedoresRouter } from "./provedores.js";
import { agendaRouter } from "./agenda.js";

function chamar(router: Router, method: string, url: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    let status = 200;
    const req: any = { method, url, headers: {}, params: {}, query: {}, body };
    const res: any = {
      status: (c: number) => ((status = c), res),
      json: (b: any) => resolve({ status, body: b }),
      send: (b: any) => resolve({ status, body: b }),
      end: () => resolve({ status, body: null }),
    };
    router(req, res, (err: any) => resolve({ status: err?.status ?? 404, body: err?.message }));
  });
}

const PROV_1 = "11111111-1111-4111-8111-111111111111";
const PROV_FORA = "33333333-3333-4333-8333-333333333333";

describe("gestor limitado a provedores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuario.atual = { sub: "gestor-id", email: "g@x", role: UserRole.GESTOR, provedorId: null, provedores: [PROV_1] };
  });

  it("GET /provedores lista so os da lista dele", async () => {
    mockPrisma.provedor.findMany.mockResolvedValue([]);
    const r = await chamar(provedoresRouter, "GET", "/");
    expect(r.status).toBe(200);
    expect(mockPrisma.provedor.findMany).toHaveBeenCalledWith({ where: { id: { in: [PROV_1] } }, orderBy: { nome: "asc" } });
  });

  it("GET /provedores do gestor sem lista continua sem filtro", async () => {
    usuario.atual = { ...usuario.atual, provedores: [] };
    mockPrisma.provedor.findMany.mockResolvedValue([]);
    await chamar(provedoresRouter, "GET", "/");
    expect(mockPrisma.provedor.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { nome: "asc" } });
  });

  it("POST /agenda em provedor fora da lista: 403, nada marcado", async () => {
    const r = await chamar(agendaRouter, "POST", "/", { provedorId: PROV_FORA, sgpOsId: "123", dia: "2026-11-10", turno: "manha" });
    expect(r.status).toBe(403);
    expect(mockAgenda.marcar).not.toHaveBeenCalled();
  });

  it("PUT /agenda/rota com ids de provedores misturados: 403, rota intacta", async () => {
    // Dos dois ids, so um esta no escopo.
    mockPrisma.agendamento.count.mockResolvedValue(1);
    const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
    const r = await chamar(agendaRouter, "PUT", "/rota", { dia: "2026-11-10", turno: "manha", ids });
    expect(r.status).toBe(403);
    expect(mockAgenda.definirRota).not.toHaveBeenCalled();
  });

  it("POST /agenda/auto/desfazer exige escopo total", async () => {
    const r = await chamar(agendaRouter, "POST", "/auto/desfazer");
    expect(r.status).toBe(403);
  });
});
