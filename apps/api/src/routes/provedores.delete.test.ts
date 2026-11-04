import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserRole } from "@isphub/shared";

const { mockPrisma, mockEmitParaTodos } = vi.hoisted(() => ({
  mockPrisma: {
    provedor: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
  mockEmitParaTodos: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../services/realtimeHub.js", () => ({ emitParaTodos: mockEmitParaTodos }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: "admin-id", role: UserRole.ADMIN };
    next();
  },
  requireRole: (..._roles: any[]) => (_req: any, _res: any, next: any) => next(),
}));

import { provedoresRouter } from "./provedores.js";

describe("DELETE /provedores/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function callRouter(method: string, url: string): Promise<{ status: number; body: any; err: any }> {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseBody: any = null;

      const req: any = {
        method,
        url,
        headers: {},
        params: {},
        query: {},
        body: {},
      };

      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        send: (b: any) => {
          responseBody = b;
          resolve({ status: statusCode, body: responseBody, err: null });
        },
        json: (b: any) => {
          responseBody = b;
          resolve({ status: statusCode, body: responseBody, err: null });
        },
        end: () => {
          resolve({ status: statusCode, body: responseBody, err: null });
        },
      };

      const next = (err: any) => {
        resolve({ status: err?.status || 500, body: null, err });
      };

      provedoresRouter(req, res, next);
    });
  }

  it("retorna 404 se provedor nao existe", async () => {
    mockPrisma.provedor.findUnique.mockResolvedValue(null);

    const res = await callRouter("DELETE", "/prov-inexistente");
    expect(res.status).toBe(404);
    expect(mockPrisma.provedor.delete).not.toHaveBeenCalled();
    expect(mockEmitParaTodos).not.toHaveBeenCalled();
  });

  it("exclui o provedor e emite config-alterada quando existe", async () => {
    mockPrisma.provedor.findUnique.mockResolvedValue({ id: "prov-123", nome: "Provedor Teste" });
    mockPrisma.provedor.delete.mockResolvedValue({ id: "prov-123" });

    const res = await callRouter("DELETE", "/prov-123");
    expect(res.status).toBe(204);
    expect(mockPrisma.provedor.delete).toHaveBeenCalledWith({ where: { id: "prov-123" } });
    expect(mockEmitParaTodos).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "config-alterada" }),
    );
  });
});
