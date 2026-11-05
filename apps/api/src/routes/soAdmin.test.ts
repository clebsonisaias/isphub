import { describe, expect, it, vi } from "vitest";
import type { Router } from "express";
import { UserRole } from "@isphub/shared";

/**
 * Rotas que eram de admin E gestor e passaram a ser SO do admin: configuracao
 * de integracao (ERP, AtendAI), tipos de OS, tecnicos do SGP, sync manual e
 * chave de parceiro. O gestor opera; quem mexe na fiacao do provedor e o dono.
 * (A lista de usuarios voltou pro gestor filtrada pela equipe dele — ver
 * usuarios.gestor.test.ts.)
 *
 * O `requireRole` e o REAL — o teste falha se alguem devolver o GESTOR a lista.
 * O prisma e um objeto vazio: se o handler rodasse, estouraria com 500.
 */
const { mockPrisma, usuario } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  usuario: { atual: { sub: "gestor-id", email: "g@x", role: "gestor", provedorId: null } as Record<string, unknown> },
}));

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
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

import { atendaiConfigRouter } from "./atendaiConfig.js";
import { erpConfigRouter } from "./erpConfig.js";
import { syncRouter } from "./sync.js";
import { tecnicosSgpRouter } from "./tecnicosSgp.js";
import { tiposOsRouter } from "./tiposOs.js";
import { provedoresRouter } from "./provedores.js";

function chamar(router: Router, method: string, url: string): Promise<{ status: number; err: any }> {
  return new Promise((resolve) => {
    let status = 200;
    const req: any = { method, url, headers: {}, params: { provedorId: "prov-1" }, query: {}, body: {} };
    const res: any = {
      status: (c: number) => ((status = c), res),
      json: () => resolve({ status, err: null }),
      send: () => resolve({ status, err: null }),
      end: () => resolve({ status, err: null }),
    };
    router(req, res, (err: any) => resolve({ status: err?.status ?? 404, err }));
  });
}

const CASOS: [string, string, string, Router][] = [
  ["atendaiConfig", "GET", "/", atendaiConfigRouter],
  ["erpConfig", "GET", "/", erpConfigRouter],
  ["erpConfig", "PUT", "/", erpConfigRouter],
  ["sync", "POST", "/", syncRouter],
  ["sync", "GET", "/logs", syncRouter],
  ["tecnicosSgp", "GET", "/", tecnicosSgpRouter],
  ["tiposOs", "GET", "/", tiposOsRouter],
  ["chave-parceiro", "GET", "/prov-1/chave-parceiro", provedoresRouter],
  ["chave-parceiro", "POST", "/prov-1/chave-parceiro", provedoresRouter],
  ["chave-parceiro", "DELETE", "/prov-1/chave-parceiro", provedoresRouter],
];

describe("rotas so do admin", () => {
  it.each(CASOS)("%s: gestor leva 403 em %s %s", async (_nome, method, url, router) => {
    usuario.atual = { sub: "gestor-id", email: "g@x", role: UserRole.GESTOR, provedorId: null };
    const r = await chamar(router, method, url);
    expect(r.status).toBe(403);
  });

  it("o admin passa pelo requireRole (chega no handler)", async () => {
    usuario.atual = { sub: "admin-id", email: "a@x", role: UserRole.ADMIN, provedorId: null };
    // Com o prisma vazio o handler estoura (500) — o que importa e NAO ser 403.
    const r = await chamar(tiposOsRouter, "GET", "/");
    expect(r.status).not.toBe(403);
  });
});
