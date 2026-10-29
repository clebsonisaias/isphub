import { beforeEach, describe, expect, it, vi } from "vitest";

/** Visita que o SGP não confirmou volta a ser enviada — sem banco nem SGP de verdade. */

const m = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), erp: vi.fn(), scheduleOs: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({
  prisma: { agendamento: { findMany: m.findMany, findUnique: m.findUnique }, erpConfig: { findFirst: m.erp } },
}));
vi.mock("./erpConnectorService.js", () => ({ buildConnector: () => ({ scheduleOs: m.scheduleOs }) }));

const { reenviarNaoConfirmadas } = await import("./agendaService.js");

const AGORA = new Date("2026-10-29T18:00:00Z"); // 15h em Natal

beforeEach(() => {
  vi.clearAllMocks();
  m.erp.mockResolvedValue({ tipo: "SGP", url: "https://sgp", app: "a", tokenCifrado: "x" });
  m.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    sgpOsId: `os-${where.id}`,
    dia: new Date("2026-10-30T00:00:00Z"),
    turno: "tarde",
    provedorId: "netgo",
    status: "marcado",
  }));
});

describe("reenvio das visitas não confirmadas pelo SGP", () => {
  it("só futuras, de OS aberta, mexidas há mais de 15 min; reenvia cada uma", async () => {
    m.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    m.scheduleOs.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SGP fora"));

    expect(await reenviarNaoConfirmadas("netgo", AGORA)).toBe(1);

    const { where, take } = m.findMany.mock.calls[0]![0];
    expect(where).toMatchObject({ provedorId: "netgo", status: "marcado", sgpConfirmadoEm: null });
    expect(where.dia.gte.toISOString().slice(0, 10)).toBe("2026-10-29");
    expect(where.atualizadoEm.lt).toEqual(new Date("2026-10-29T17:45:00Z"));
    expect(where.ordemServico).toEqual({ status: { in: ["aberta", "pendente"] } });
    expect(take).toBe(30);
    expect(m.scheduleOs).toHaveBeenCalledTimes(2);
    expect(m.scheduleOs).toHaveBeenCalledWith("os-a1", new Date("2026-10-30T16:00:00Z"));
  });
});
