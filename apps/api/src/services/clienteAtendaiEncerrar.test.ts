import { beforeEach, describe, expect, it, vi } from "vitest";

/** OS concluida encerra a conversa com o cliente (a CláudIA volta) — sem banco nem AtendAI de verdade. */

const m = vi.hoisted(() => ({
  conversas: vi.fn(),
  osConcluidas: vi.fn(),
  atualizar: vi.fn(),
  chamar: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    conversaCliente: { findMany: m.conversas, update: m.atualizar },
    ordemServico: { findMany: m.osConcluidas },
  },
}));
vi.mock("./atendaiService.js", () => ({
  AtendaiIndisponivel: class extends Error {
    constructor(
      public status: number,
      msg: string,
    ) {
      super(msg);
    }
  },
  chamar: m.chamar,
  credencialDoProvedor: async () => ({ baseUrl: "http://atendai", chave: "ak_x" }),
}));
vi.mock("./ponteChatAtendaiService.js", () => ({ cadastrarNoAtendai: vi.fn() }));
vi.mock("./realtimeHub.js", () => ({ emitParaTodos: vi.fn() }));
vi.mock("./pushService.js", () => ({ dispararPush: vi.fn() }));

const { encerrarConversasDeOsConcluidas } = await import("./clienteAtendaiService.js");

const conversa = (id: string, os: string) => ({ id, provedorId: "netgo", atendaiConversaId: `atd-${id}`, ordemServicoId: os });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.chamar.mockResolvedValue({ ok: true });
});

describe("OS concluida encerra a conversa com o cliente", () => {
  it("so a da OS concluida: encerra no AtendAI, arquiva e desvincula a OS", async () => {
    m.conversas.mockResolvedValue([conversa("c1", "os-concluida"), conversa("c2", "os-aberta")]);
    m.osConcluidas.mockResolvedValue([{ id: "os-concluida" }]);

    expect(await encerrarConversasDeOsConcluidas({ provedorId: "netgo" })).toBe(1);
    expect(m.chamar).toHaveBeenCalledTimes(1);
    expect(m.chamar).toHaveBeenCalledWith(expect.anything(), "POST", "/atendimentos/atd-c1/encerrar");
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "c1" }, data: { arquivada: true, ordemServicoId: null } });
  });

  it("AtendAI fora do ar: a conversa fica aberta e vinculada (tenta no proximo sync)", async () => {
    m.conversas.mockResolvedValue([conversa("c1", "os-concluida")]);
    m.osConcluidas.mockResolvedValue([{ id: "os-concluida" }]);
    m.chamar.mockRejectedValue(new Error("timeout"));

    expect(await encerrarConversasDeOsConcluidas({ ordemServicoId: "os-concluida" })).toBe(0);
    expect(m.atualizar).not.toHaveBeenCalled();
  });

  it("sem conversa aberta: nem consulta as OS", async () => {
    m.conversas.mockResolvedValue([]);
    expect(await encerrarConversasDeOsConcluidas({ provedorId: "netgo" })).toBe(0);
    expect(m.osConcluidas).not.toHaveBeenCalled();
  });
});
