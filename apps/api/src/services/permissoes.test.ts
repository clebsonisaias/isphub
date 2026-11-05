import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_SEMPRE_LIVRE,
  AREAS,
  UserRole,
  gestorPode,
  normalizarPermissoes,
  podeGerirUsuario,
  podeRotaWeb,
} from "@isphub/shared";

/*
 * Regras puras de packages/shared/permissoes.ts (o shared nao tem vitest) e a
 * checagem no requireAuth. O ADMIN nunca passa por aqui; o gestor com
 * `permissoes` nulo tambem nao (acesso total, como sempre foi).
 */

const { mockVerifyToken, mockObterEstadoSessao } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockObterEstadoSessao: vi.fn(),
}));
vi.mock("./authService.js", () => ({ verifyToken: mockVerifyToken }));
vi.mock("./sessaoService.js", () => ({ obterEstadoSessao: mockObterEstadoSessao }));
vi.mock("../middleware/presenca.js", () => ({ tocarPresenca: vi.fn() }));

import { requireAuth } from "../middleware/auth.js";

describe("gestorPode", () => {
  it("rotas sempre livres passam mesmo sem area nenhuma", () => {
    expect(gestorPode({}, "POST", "/auth/logout")).toBe(true);
    expect(gestorPode({}, "POST", "/notificacoes/1/lida")).toBe(true);
    expect(gestorPode({}, "GET", "/eventos")).toBe(true);
    expect(gestorPode({}, "GET", "/provedores/abc")).toBe(true);
    expect(gestorPode({}, "GET", "/linha-movel/minha")).toBe(true);
    // Sempre livre e so leitura: escrever em provedor/config continua fechado.
    expect(gestorPode({}, "PUT", "/provedores/abc")).toBe(false);
    expect(gestorPode({}, "GET", "/provedores/abc/chave-parceiro")).toBe(false);
  });

  it("'ver' le e nao escreve; 'editar' faz os dois", () => {
    expect(gestorPode({ frota: "ver" }, "GET", "/frota/veiculos")).toBe(true);
    expect(gestorPode({ frota: "ver" }, "HEAD", "/frota/veiculos")).toBe(true);
    expect(gestorPode({ frota: "ver" }, "PATCH", "/frota/veiculos/1")).toBe(false);
    expect(gestorPode({ frota: "editar" }, "PATCH", "/frota/veiculos/1")).toBe(true);
  });

  it("leitura vinda de outra area: so GET, nunca escrita", () => {
    // A Escala le os veiculos da Frota, mas nao edita.
    expect(gestorPode({ escala: "editar" }, "GET", "/frota/veiculos")).toBe(true);
    expect(gestorPode({ escala: "editar" }, "POST", "/frota/veiculos")).toBe(false);
    expect(gestorPode({ escala: "editar" }, "GET", "/frota/mapa")).toBe(false);
    // O Despacho le a fila e escreve so a atribuicao.
    expect(gestorPode({ despacho: "editar" }, "GET", "/fila")).toBe(true);
    expect(gestorPode({ despacho: "editar" }, "POST", "/ordens-servico/1/atribuir")).toBe(true);
    expect(gestorPode({ despacho: "editar" }, "POST", "/ordens-servico/1/encerrar")).toBe(false);
  });

  it("chat so com 'editar' — e nao confunde com /chat-clientes", () => {
    expect(gestorPode({ chat: "ver" }, "GET", "/chat/conversas")).toBe(false);
    expect(gestorPode({ chat: "editar" }, "GET", "/chat/conversas")).toBe(true);
    expect(gestorPode({ chat: "editar" }, "GET", "/chat-clientes/conversas")).toBe(false);
    expect(gestorPode({ chatClientes: "editar" }, "GET", "/chat/conversas")).toBe(false);
  });

  it("negacao por padrao: rota que nenhuma area possui", () => {
    const tudo = Object.fromEntries(Object.keys(AREAS).map((a) => [a, "editar"]));
    expect(gestorPode(tudo, "GET", "/financeiro/lancamentos")).toBe(false);
    expect(gestorPode(tudo, "GET", "/admin/smtp")).toBe(false);
    expect(gestorPode({}, "GET", "/fila")).toBe(false);
  });

  it("ignora a query string", () => {
    expect(gestorPode({ fila: "ver" }, "GET", "/fila?grupo=abertos&busca=/frota")).toBe(true);
    expect(gestorPode({ fila: "ver" }, "GET", "/frota/veiculos?x=/fila")).toBe(false);
  });

  it("null = acesso total", () => {
    expect(gestorPode(null, "DELETE", "/qualquer/coisa")).toBe(true);
  });
});

describe("podeRotaWeb", () => {
  it("'/' casa so exato; as outras, o prefixo", () => {
    expect(podeRotaWeb({ fila: "ver" }, "/")).toBe(true);
    expect(podeRotaWeb({ fila: "ver" }, "/os/123")).toBe(true);
    expect(podeRotaWeb({ frota: "ver" }, "/")).toBe(false);
    expect(podeRotaWeb({ frota: "ver" }, "/frota/veiculos/1")).toBe(true);
    // Prefixo de verdade, nao de texto: /chat nao abre /chat-clientes.
    expect(podeRotaWeb({ chat: "editar" }, "/chat-clientes")).toBe(false);
  });

  it("perfil sempre; null libera tudo", () => {
    expect(podeRotaWeb({}, "/perfil")).toBe(true);
    expect(podeRotaWeb({}, "/despacho")).toBe(false);
    expect(podeRotaWeb(null, "/despacho")).toBe(true);
  });
});

describe("normalizarPermissoes", () => {
  it("null continua null (acesso total)", () => {
    expect(normalizarPermissoes(null)).toBeNull();
  });

  it("lixo FECHA (vira {}), nunca abre", () => {
    for (const lixo of ["editar", 42, [], ["fila"], true, undefined]) {
      expect(normalizarPermissoes(lixo)).toEqual({});
    }
  });

  it("so areas e niveis conhecidos; 'ver' em area so-editar e descartado", () => {
    expect(normalizarPermissoes({ fila: "ver", frota: "admin", inventada: "editar", chat: "ver", agenda: "editar" })).toEqual({
      fila: "ver",
      agenda: "editar",
    });
    expect(normalizarPermissoes({ chat: "editar" })).toEqual({ chat: "editar" });
  });

  it("ordem das chaves estavel (comparar por JSON funciona)", () => {
    expect(JSON.stringify(normalizarPermissoes({ frota: "ver", fila: "ver" }))).toBe(
      JSON.stringify(normalizarPermissoes({ fila: "ver", frota: "ver" })),
    );
  });
});

describe("podeGerirUsuario", () => {
  const admin = { role: UserRole.ADMIN };
  const gestor = { role: UserRole.GESTOR, provedores: [] as string[] };
  const limitado = { role: UserRole.GESTOR, provedores: ["p1"] };

  it("admin gere qualquer um", () => {
    for (const role of Object.values(UserRole)) {
      expect(podeGerirUsuario(admin, { role, provedorId: null })).toBe(true);
    }
  });

  it("gestor so a equipe de campo — nunca admin, gestor ou provedor", () => {
    expect(podeGerirUsuario(gestor, { role: UserRole.TECNICO, provedorId: null })).toBe(true);
    expect(podeGerirUsuario(gestor, { role: UserRole.ATENDENTE, provedorId: "p9" })).toBe(true);
    expect(podeGerirUsuario(gestor, { role: UserRole.VENDEDOR, provedorId: "p9" })).toBe(true);
    for (const role of [UserRole.ADMIN, UserRole.GESTOR, UserRole.PROVEDOR]) {
      expect(podeGerirUsuario(gestor, { role, provedorId: null })).toBe(false);
    }
  });

  it("gestor limitado: atendente/vendedor so dos provedores dele; tecnico e de todos", () => {
    expect(podeGerirUsuario(limitado, { role: UserRole.ATENDENTE, provedorId: "p1" })).toBe(true);
    expect(podeGerirUsuario(limitado, { role: UserRole.ATENDENTE, provedorId: "p2" })).toBe(false);
    expect(podeGerirUsuario(limitado, { role: UserRole.VENDEDOR, provedorId: null })).toBe(false);
    expect(podeGerirUsuario(limitado, { role: UserRole.TECNICO, provedorId: null })).toBe(true);
  });

  it("outros papeis nao gerem ninguem", () => {
    expect(podeGerirUsuario({ role: UserRole.TECNICO }, { role: UserRole.TECNICO, provedorId: null })).toBe(false);
  });
});

/**
 * Toda rota montada em app.ts precisa ter dono: so-admin, publica/parceiro, ou
 * coberta por uma area ou pelo sempre-livre. Rota nova esquecida derruba este
 * teste — e ai alguem decide, em vez de o gestor limitado levar 403 em silencio
 * (ou de uma rota de admin ser liberada por engano).
 */
describe("cobertura das rotas de app.ts", () => {
  const fonte = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
  const prefixos = [...fonte.matchAll(/app\.use\(\s*"([^"]+)"/g)].map((m) => m[1]!);

  /** Admin-only (requireRole(ADMIN) no router) — o gestor nunca alcanca. */
  const SO_ADMIN = [
    "/admin/modulos",
    "/admin/canais-whatsapp",
    "/admin/smtp",
    "/admin/diagnostico",
    "/financeiro",
    "/financeiro/lancamentos/:id/comprovante",
    "/provedores/:provedorId/erp-config",
    "/provedores/:provedorId/atendai",
    "/provedores/:provedorId/tipos-os",
    "/provedores/:provedorId/tecnicos-sgp",
    "/provedores/:provedorId/sync",
  ];
  /** Sem requireAuth: webhook assinado, segredo proprio ou chave de parceiro. */
  const PUBLICOS = ["/webhooks/whatsapp", "/api/planilha", "/api/atendai/chat", "/api/parceiro/v1/agenda"];

  const regexes = [
    ...Object.values(AREAS).flatMap((a) => [...a.api, ...(a.leitura ?? [])]),
    ...API_SEMPRE_LIVRE.map(([, c]) => c),
  ];
  /** A regex casa o prefixo, ou e de uma rota debaixo dele (ex.: `^/sync/minhas-os$` sob `/sync`). */
  const cobre = (r: RegExp, amostra: string) =>
    r.test(amostra) || r.source.replace(/\\\//g, "/").startsWith(`^${amostra}/`);

  it("achou os prefixos", () => {
    expect(prefixos.length).toBeGreaterThan(30);
  });

  it.each(prefixos)("%s tem dono", (prefixo) => {
    if (SO_ADMIN.includes(prefixo) || PUBLICOS.includes(prefixo)) return;
    const amostra = prefixo.replace(/:[^/]+/g, "x");
    expect(
      regexes.some((r) => cobre(r, amostra)),
      `${prefixo} nao esta em nenhuma area nem nas listas de so-admin/publicos (packages/shared/src/permissoes.ts)`,
    ).toBe(true);
  });
});

describe("requireAuth com permissoes do gestor", () => {
  function chamar(method: string, url: string): Promise<{ status: number }> {
    return new Promise((resolve) => {
      const req: any = { method, originalUrl: url, headers: { authorization: "Bearer t" } };
      void requireAuth(req, {} as any, (err?: any) => resolve({ status: err ? err.status : 200 }));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockReturnValue({ sub: "g1", email: "g@x", role: UserRole.GESTOR, provedorId: null, tv: 0 });
  });

  it("frota 'ver': GET passa, PATCH leva 403", async () => {
    mockObterEstadoSessao.mockResolvedValue({ ativo: true, tokenVersion: 0, provedores: [], permissoes: { frota: "ver" } });
    expect((await chamar("GET", "/frota/veiculos")).status).toBe(200);
    expect((await chamar("PATCH", "/frota/veiculos/1")).status).toBe(403);
  });

  it("permissoes nulas: gestor de sempre, sem restricao", async () => {
    mockObterEstadoSessao.mockResolvedValue({ ativo: true, tokenVersion: 0, provedores: [], permissoes: null });
    expect((await chamar("PATCH", "/frota/veiculos/1")).status).toBe(200);
  });

  it("escopo vem do banco, nao do token", async () => {
    mockVerifyToken.mockReturnValue({
      sub: "g1",
      email: "g@x",
      role: UserRole.GESTOR,
      provedorId: null,
      tv: 0,
      provedores: [],
      permissoes: null,
    });
    mockObterEstadoSessao.mockResolvedValue({ ativo: true, tokenVersion: 0, provedores: ["p1"], permissoes: { fila: "ver" } });
    const req: any = { method: "GET", originalUrl: "/fila", headers: { authorization: "Bearer t" } };
    await new Promise((r) => requireAuth(req, {} as any, r as any));
    expect(req.user.provedores).toEqual(["p1"]);
    expect(req.user.permissoes).toEqual({ fila: "ver" });
    expect((await chamar("PATCH", "/frota/veiculos/1")).status).toBe(403);
  });
});
