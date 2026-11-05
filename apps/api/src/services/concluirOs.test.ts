import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsStatus, SgpOsStatus } from "@isphub/shared";

/**
 * Concluir/cancelar pelo ISPhub ENCERRA no SGP (05/11/2026): status Encerrada,
 * servico prestado, fim da ocorrencia e aviso ao cliente — pelo `encerrarOs`.
 * Os outros status seguem so trocando o status (`updateOsStatus`).
 */

const m = vi.hoisted(() => ({
  osFind: vi.fn(),
  osUpdate: vi.fn(),
  erp: vi.fn(),
  eventoFindFirst: vi.fn(),
  evento: vi.fn(),
  tx: vi.fn(),
  buildConnector: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    ordemServico: { findUnique: m.osFind, update: m.osUpdate },
    erpConfig: { findFirst: m.erp },
    osEvento: { create: m.evento, findFirst: m.eventoFindFirst },
    $transaction: m.tx,
  },
}));
vi.mock("./erpConnectorService.js", () => ({ buildConnector: m.buildConnector }));
vi.mock("./realtimeHub.js", () => ({ emitParaUsuario: vi.fn(), emitParaTodos: vi.fn() }));
vi.mock("./pushService.js", () => ({ dispararPush: vi.fn() }));
vi.mock("./clienteAtendaiService.js", () => ({ encerrarConversasDeOsConcluidas: vi.fn().mockResolvedValue(undefined), avisarClienteACaminho: vi.fn() }));

const { mudarStatus } = await import("./writebackService.js");

let sgp: { encerrarOs: ReturnType<typeof vi.fn>; updateOsStatus: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  sgp = { encerrarOs: vi.fn().mockResolvedValue(undefined), updateOsStatus: vi.fn().mockResolvedValue(undefined) };
  m.buildConnector.mockReturnValue(sgp);
  m.erp.mockResolvedValue({ id: "cfg", provedorId: "netgo", tipo: "SGP", ativo: true });
  m.osFind.mockResolvedValue({ id: "os-1", provedorId: "netgo", sgpOsId: "212935", tecnicoId: "tec-1", status: OsStatus.EM_EXECUCAO });
  m.eventoFindFirst.mockResolvedValue(null);
  m.osUpdate.mockImplementation((a) => a);
  m.evento.mockImplementation((a) => a);
  m.tx.mockImplementation(async (ops: unknown[]) => [{ id: "os-1", tecnicoId: "tec-1" }, ...ops.slice(1)]);
});

describe("mudarStatus que encerra", () => {
  it("concluir usa encerrarOs com o servico prestado do campo (sem buscar anotacao)", async () => {
    await mudarStatus("os-1", OsStatus.CONCLUIDA, "tec-1", undefined, "Troca do conector");

    expect(sgp.encerrarOs).toHaveBeenCalledWith("212935", { servicoPrestado: "Troca do conector" });
    expect(sgp.updateOsStatus).not.toHaveBeenCalled();
    expect(m.eventoFindFirst).not.toHaveBeenCalled();
  });

  it("sem o campo, usa a anotacao recente do mesmo autor nesta OS (o que o app faz hoje)", async () => {
    m.eventoFindFirst.mockResolvedValue({ descricao: "Reconfigurei a ONU" });

    await mudarStatus("os-1", OsStatus.CONCLUIDA, "tec-1");

    expect(sgp.encerrarOs).toHaveBeenCalledWith("212935", { servicoPrestado: "Reconfigurei a ONU" });
    const where = m.eventoFindFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ ordemServicoId: "os-1", autorId: "tec-1", tipo: "anotacao" });
    // Janela de 15 min.
    const desde = where.criadoEm.gte as Date;
    expect(Date.now() - desde.getTime()).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(Date.now() - desde.getTime()).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it("sem campo nem anotacao recente, encerra sem servico prestado", async () => {
    await mudarStatus("os-1", OsStatus.CANCELADA, "u-gestor");
    expect(sgp.encerrarOs).toHaveBeenCalledWith("212935", { servicoPrestado: null });
  });

  it.each([
    [OsStatus.PENDENTE, SgpOsStatus.PENDENTE],
    [OsStatus.EM_EXECUCAO, SgpOsStatus.EM_EXECUCAO],
  ])("%s continua so trocando o status (updateOsStatus)", async (status, codigo) => {
    m.osFind.mockReset();
    m.osFind
      .mockResolvedValueOnce({ id: "os-1", provedorId: "netgo", sgpOsId: "212935", tecnicoId: null, status: OsStatus.ABERTA })
      .mockResolvedValueOnce({ apoios: [] });

    await mudarStatus("os-1", status, "tec-1");

    expect(sgp.updateOsStatus).toHaveBeenCalledWith("212935", codigo);
    expect(sgp.encerrarOs).not.toHaveBeenCalled();
  });
});
