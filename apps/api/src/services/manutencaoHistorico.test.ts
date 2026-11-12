import { beforeEach, describe, expect, it, vi } from "vitest";

const plano = { findUnique: vi.fn(), update: vi.fn() };
const realizada = { create: vi.fn() };
const transacao = vi.fn(async (ops: unknown[]) => Promise.all(ops));
vi.mock("../lib/prisma.js", () => ({
  prisma: { planoManutencao: plano, manutencaoRealizada: realizada, $transaction: (ops: unknown[]) => transacao(ops) },
}));

const { concluirPlano } = await import("./manutencaoService.js");

describe("concluirPlano", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plano.findUnique.mockResolvedValue({ veiculoId: "v1", tipo: "Troca de óleo" });
    plano.update.mockImplementation(async (a: { data: object }) => ({ id: "p1", veiculoId: "v1", ...a.data }));
    realizada.create.mockImplementation(async (a: { data: object }) => a.data);
  });

  it("atualiza o plano E grava uma linha no historico, na mesma transacao", async () => {
    await concluirPlano("p1", 52_300, "u-gestor");
    expect(transacao).toHaveBeenCalledTimes(1);
    const dadosPlano = plano.update.mock.calls[0]![0].data;
    const dadosHist = realizada.create.mock.calls[0]![0].data;
    expect(dadosPlano).toMatchObject({ ultimaKm: 52_300, avisadoEm: null });
    expect(dadosHist).toMatchObject({ veiculoId: "v1", planoId: "p1", tipo: "Troca de óleo", km: 52_300, registradoPor: "u-gestor" });
    // O mesmo instante nos dois: o historico nao pode discordar do plano.
    expect(dadosHist.em).toEqual(dadosPlano.ultimaEm);
  });

  it("concluir duas vezes gera duas linhas (antes a segunda apagava a primeira)", async () => {
    await concluirPlano("p1", 50_000, "u1");
    await concluirPlano("p1", 60_000, "u1");
    expect(realizada.create).toHaveBeenCalledTimes(2);
  });

  it("plano inexistente: 404, sem gravar historico", async () => {
    plano.findUnique.mockResolvedValue(null);
    await expect(concluirPlano("x", 1)).rejects.toMatchObject({ status: 404 });
    expect(realizada.create).not.toHaveBeenCalled();
  });
});
