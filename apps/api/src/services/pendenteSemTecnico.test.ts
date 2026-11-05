import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsStatus, SgpOsStatus } from "@isphub/shared";

/**
 * OS PENDENTE NAO TEM TECNICO NO ISPHUB (pedido de 05/11/2026): cliente sem
 * retorno, instalacao tentada varias vezes. Ela sai do despacho — pelo ISPhub
 * (mudarStatus), pelo SGP (passo do sync) — e ninguem designa tecnico nela
 * enquanto estiver pendente. O SGP nao e tocado: continua com o tecnico dele.
 */

const m = vi.hoisted(() => ({
  osFind: vi.fn(),
  osFindMany: vi.fn(),
  osUpdate: vi.fn(),
  erp: vi.fn(),
  usuario: vi.fn(),
  evento: vi.fn(),
  tx: vi.fn(),
  buildConnector: vi.fn(),
  emitParaTodos: vi.fn(),
  emitParaUsuario: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    ordemServico: { findUnique: m.osFind, findMany: m.osFindMany, update: m.osUpdate },
    erpConfig: { findFirst: m.erp },
    usuario: { findUnique: m.usuario },
    osEvento: { create: m.evento },
    $transaction: m.tx,
  },
}));
vi.mock("./erpConnectorService.js", () => ({ buildConnector: m.buildConnector }));
vi.mock("./realtimeHub.js", () => ({ emitParaUsuario: m.emitParaUsuario, emitParaTodos: m.emitParaTodos }));
vi.mock("./pushService.js", () => ({ dispararPush: vi.fn() }));
vi.mock("./clienteAtendaiService.js", () => ({ encerrarConversasDeOsConcluidas: vi.fn(), avisarClienteACaminho: vi.fn() }));

const { mudarStatus, atribuirTecnico, desvincularPendentes, DESVINCULO_PENDENTE } = await import("./writebackService.js");

let sgp: { updateOsStatus: ReturnType<typeof vi.fn> };
const osAberta = { id: "os-1", provedorId: "netgo", sgpOsId: "213347", tecnicoId: "tec-1", status: OsStatus.ABERTA };

/** Os `data` de cada osEvento.create, na ordem. */
const eventos = () => m.evento.mock.calls.map(([a]) => a.data);
/** Quem levou "os-removida" pelo SSE. */
const removidos = () =>
  m.emitParaUsuario.mock.calls.filter(([u, e]) => u && e.tipo === "os-removida").map(([u]) => u);

beforeEach(() => {
  vi.clearAllMocks();
  sgp = { updateOsStatus: vi.fn().mockResolvedValue(undefined) };
  m.buildConnector.mockReturnValue(sgp);
  m.erp.mockResolvedValue({ id: "cfg", provedorId: "netgo", tipo: "SGP", ativo: true });
  // 1a busca: a OS (loadOsWithConnector); 2a: os apoios dela (so quando vira pendente).
  m.osFind.mockResolvedValueOnce(osAberta).mockResolvedValueOnce({ apoios: [{ id: "apoio-1" }] });
  m.osUpdate.mockImplementation((a) => a);
  m.evento.mockImplementation((a) => a);
  m.tx.mockImplementation(async (ops: unknown[]) => [{ id: "os-1", tecnicoId: null }, ...ops.slice(1)]);
});

describe("mudarStatus para PENDENTE", () => {
  it("desvincula titular e apoios na mesma transacao do status, registra o evento e avisa quem perdeu", async () => {
    await mudarStatus("os-1", OsStatus.PENDENTE, "u-gestor");

    expect(sgp.updateOsStatus).toHaveBeenCalledWith("213347", SgpOsStatus.PENDENTE);
    expect(m.osUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OsStatus.PENDENTE, tecnicoId: null, apoios: { set: [] } }),
      }),
    );
    expect(m.tx).toHaveBeenCalledTimes(1);
    expect(eventos()).toEqual([
      expect.objectContaining({ tipo: "status", statusPara: OsStatus.PENDENTE }),
      expect.objectContaining({ tipo: "atribuicao", autorId: "u-gestor", descricao: DESVINCULO_PENDENTE }),
    ]);
    expect(removidos()).toEqual(["tec-1", "apoio-1"]);
  });

  it("sem tecnico nem apoio: muda o status e nao inventa evento de desvinculo", async () => {
    m.osFind.mockReset();
    m.osFind.mockResolvedValueOnce({ ...osAberta, tecnicoId: null }).mockResolvedValueOnce({ apoios: [] });

    await mudarStatus("os-1", OsStatus.PENDENTE, "u-gestor");

    expect(m.osUpdate.mock.calls[0]![0].data).not.toHaveProperty("tecnicoId");
    expect(eventos().map((e) => e.tipo)).toEqual(["status"]);
    expect(removidos()).toEqual([]);
  });

  it("outro status nao mexe no tecnico (nem busca os apoios)", async () => {
    await mudarStatus("os-1", OsStatus.EM_EXECUCAO, "u-tec");

    expect(m.osFind).toHaveBeenCalledTimes(1);
    expect(m.osUpdate.mock.calls[0]![0].data).not.toHaveProperty("tecnicoId");
    expect(m.osUpdate.mock.calls[0]![0].data).not.toHaveProperty("apoios");
    expect(eventos().map((e) => e.tipo)).toEqual(["status"]);
  });
});

describe("atribuir tecnico", () => {
  it("OS PENDENTE: 409 com a instrucao, sem gravar nada", async () => {
    m.osFind.mockReset();
    m.osFind.mockResolvedValue({ ...osAberta, tecnicoId: null, status: OsStatus.PENDENTE });

    await expect(atribuirTecnico("os-1", "tec-2", "u-gestor")).rejects.toMatchObject({
      status: 409,
      message: "OS pendente: mude o status antes de designar um técnico",
    });
    expect(m.tx).not.toHaveBeenCalled();
  });
});

describe("desvincularPendentes (passo do sync)", () => {
  it("so busca PENDENTE do provedor com tecnico ou apoio", async () => {
    m.osFindMany.mockResolvedValue([]);
    await desvincularPendentes("netgo");
    expect(m.osFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provedorId: "netgo",
          status: OsStatus.PENDENTE,
          OR: [{ tecnicoId: { not: null } }, { apoios: { some: {} } }],
        },
      }),
    );
  });

  it("tira tecnico e apoios de cada OS, um evento sem autor por OS, avisa quem perdeu e as telas uma vez", async () => {
    m.osFindMany.mockResolvedValue([
      { id: "os-a", tecnicoId: "tec-1", apoios: [{ id: "apoio-1" }] },
      { id: "os-b", tecnicoId: null, apoios: [{ id: "apoio-2" }] },
    ]);

    expect(await desvincularPendentes("netgo")).toBe(2);

    expect(m.osUpdate.mock.calls.map(([a]) => a)).toEqual([
      { where: { id: "os-a" }, data: { tecnicoId: null, apoios: { set: [] } } },
      { where: { id: "os-b" }, data: { tecnicoId: null, apoios: { set: [] } } },
    ]);
    expect(eventos()).toEqual([
      expect.objectContaining({ ordemServicoId: "os-a", tipo: "atribuicao", autorId: null, descricao: DESVINCULO_PENDENTE }),
      expect.objectContaining({ ordemServicoId: "os-b", tipo: "atribuicao", autorId: null, descricao: DESVINCULO_PENDENTE }),
    ]);
    expect(removidos()).toEqual(["tec-1", "apoio-1", "apoio-2"]);
    expect(m.emitParaTodos).toHaveBeenCalledTimes(1);
    expect(m.emitParaTodos).toHaveBeenCalledWith(expect.objectContaining({ tipo: "os-alterada" }));
  });

  it("nada a desvincular: nao escreve nem avisa", async () => {
    m.osFindMany.mockResolvedValue([]);
    expect(await desvincularPendentes("netgo")).toBe(0);
    expect(m.tx).not.toHaveBeenCalled();
    expect(m.emitParaTodos).not.toHaveBeenCalled();
  });
});
