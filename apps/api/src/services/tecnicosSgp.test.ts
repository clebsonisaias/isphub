import { describe, expect, it, vi } from "vitest";
import { OsStatus } from "@isphub/shared";

const m = vi.hoisted(() => ({ tecnicoSgpFindMany: vi.fn(), osFindMany: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({
  prisma: { tecnicoSgp: { findMany: m.tecnicoSgpFindMany }, ordemServico: { findMany: m.osFindMany } },
}));
vi.mock("./writebackService.js", () => ({ atribuirTecnico: vi.fn() }));

const { espelharDespachoSgp, vinculoAutomatico } = await import("./tecnicosSgpService.js");

const tecnicos = [
  { id: "a", nome: "Alderi" },
  { id: "i", nome: "Izarleson (Major)" },
  { id: "t", nome: "Thiago Jhonatan" },
  { id: "j1", nome: "João Batista" },
];

describe("vinculo automatico tecnico do SGP -> ISPhub", () => {
  it("nome identico (sem acento, caixa e apelido) vincula", () => {
    expect(vinculoAutomatico({ nome: "alderi", username: "alderi" }, tecnicos)).toBe("a");
    expect(vinculoAutomatico({ nome: "IZARLESON", username: null }, tecnicos)).toBe("i");
  });

  it("sem nome, usa o login", () => {
    expect(vinculoAutomatico({ nome: null, username: "izarleson" }, tecnicos)).toBe("i");
  });

  it("nome diferente nao vincula: o admin decide ('JONATHAN' nao e 'Thiago Jhonatan')", () => {
    expect(vinculoAutomatico({ nome: "JONATHAN", username: "jonathan" }, tecnicos)).toBeNull();
    expect(vinculoAutomatico({ nome: "joao", username: "joao" }, tecnicos)).toBeNull();
    expect(vinculoAutomatico({ nome: "Hotspot", username: null }, tecnicos)).toBeNull();
  });

  it("dois candidatos com o mesmo nome: nao chuta", () => {
    expect(vinculoAutomatico({ nome: "Ana", username: null }, [{ id: "1", nome: "Ana" }, { id: "2", nome: "ana" }])).toBeNull();
  });

  it("sem nome nem login: nada", () => {
    expect(vinculoAutomatico({ nome: null, username: null }, tecnicos)).toBeNull();
  });
});

describe("espelho do despacho do SGP", () => {
  it("ignora OS PENDENTE: ela nao tem tecnico no ISPhub, mesmo com o SGP designando um", async () => {
    m.tecnicoSgpFindMany.mockResolvedValue([]);
    m.osFindMany.mockResolvedValue([]);

    await espelharDespachoSgp("netgo");

    const status = m.osFindMany.mock.calls[0]![0].where.status.in as OsStatus[];
    expect(status).not.toContain(OsStatus.PENDENTE);
    expect(status).toEqual(expect.arrayContaining([OsStatus.ABERTA, OsStatus.EM_DESLOCAMENTO, OsStatus.EM_EXECUCAO]));
  });
});
