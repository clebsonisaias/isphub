import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsStatus } from "@isphub/shared";

/** Encerrar OS sem visita pela tela de marcar: o SGP fica sabendo quem e por quê. */

const m = vi.hoisted(() => ({
  osFind: vi.fn(),
  osUpdate: vi.fn(),
  erp: vi.fn(),
  usuario: vi.fn(),
  agendaUpdate: vi.fn(),
  evento: vi.fn(),
  tx: vi.fn(),
  buildConnector: vi.fn(),
  emitParaTodos: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    ordemServico: { findUnique: m.osFind, update: m.osUpdate },
    erpConfig: { findFirst: m.erp },
    usuario: { findUnique: m.usuario },
    agendamento: { updateMany: m.agendaUpdate },
    osEvento: { create: m.evento },
    $transaction: m.tx,
  },
}));
vi.mock("./erpConnectorService.js", () => ({ buildConnector: m.buildConnector }));
vi.mock("./realtimeHub.js", () => ({ emitParaUsuario: vi.fn(), emitParaTodos: m.emitParaTodos }));
vi.mock("./pushService.js", () => ({ dispararPush: vi.fn() }));
vi.mock("./clienteAtendaiService.js", () => ({ encerrarConversasDeOsConcluidas: vi.fn() }));

const { encerrarSemVisita } = await import("./writebackService.js");

let chamadas: string[];
let sgp: { addOsNote: ReturnType<typeof vi.fn>; encerrarOs: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  chamadas = [];
  sgp = {
    addOsNote: vi.fn(async (_os: string, texto: string) => void chamadas.push(`nota:${texto}`)),
    encerrarOs: vi.fn(async (_os: string, o: { servicoPrestado?: string | null }) => void chamadas.push(`encerra:${o.servicoPrestado}`)),
  };
  m.buildConnector.mockReturnValue(sgp);
  m.osFind.mockResolvedValue({ id: "os-1", provedorId: "netgo", sgpOsId: "213347", tecnicoId: null, status: OsStatus.ABERTA });
  m.erp.mockResolvedValue({ id: "cfg", provedorId: "netgo", tipo: "SGP", ativo: true });
  m.usuario.mockResolvedValue({ nome: "Marília" });
  m.osUpdate.mockImplementation((a) => a);
  m.agendaUpdate.mockImplementation((a) => a);
  m.evento.mockImplementation((a) => a);
  m.tx.mockImplementation(async (ops: unknown[]) => [{ id: "os-1", tecnicoId: null }, ...ops.slice(1)]);
});

describe("encerrar OS sem visita", () => {
  it("anota no SGP quem e por quê ANTES de encerrar; no ISPhub vira cancelada e a visita sai da agenda", async () => {
    await encerrarSemVisita("os-1", "A internet voltou, cliente confirmou", "u-marilia");

    expect(chamadas).toEqual([
      "nota:Encerrada pelo ISPhub por Marília, sem visita. Motivo: A internet voltou, cliente confirmou",
      "encerra:Encerrada sem visita: A internet voltou, cliente confirmou",
    ]);
    expect(m.osUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: OsStatus.CANCELADA }) }));
    expect(m.agendaUpdate).toHaveBeenCalledWith({
      where: { provedorId: "netgo", sgpOsId: "213347", status: "marcado" },
      data: { status: "cancelado", ordemRota: null },
    });
    // Painel e Despacho de todas as telas recarregam na hora.
    expect(m.emitParaTodos).toHaveBeenCalledWith(expect.objectContaining({ tipo: "os-alterada" }));
  });

  it("SGP recusou o encerramento: nada muda no ISPhub", async () => {
    sgp.encerrarOs.mockRejectedValue(new Error("SGP 500 em https://sgp/api/os/update"));
    await expect(encerrarSemVisita("os-1", "Cliente desistiu da visita", "u-marilia")).rejects.toMatchObject({ status: 502 });
    expect(m.tx).not.toHaveBeenCalled();
    expect(m.emitParaTodos).not.toHaveBeenCalled();
  });

  it("OS já encerrada: recusa sem chamar o SGP", async () => {
    m.osFind.mockResolvedValue({ id: "os-1", provedorId: "netgo", sgpOsId: "213347", tecnicoId: null, status: OsStatus.CONCLUIDA });
    await expect(encerrarSemVisita("os-1", "A internet voltou", "u-marilia")).rejects.toMatchObject({ status: 409 });
    expect(chamadas).toEqual([]);
  });
});
