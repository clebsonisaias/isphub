import { describe, expect, it } from "vitest";
import { mapSgpOsStatus, OsStatus, toSgpOsStatus } from "@isphub/shared";

describe("mapSgpOsStatus (SGP -> ISPhub)", () => {
  it.each([
    [0, OsStatus.ABERTA],
    [1, OsStatus.CONCLUIDA],
    [2, OsStatus.EM_EXECUCAO],
    [3, OsStatus.PENDENTE],
  ])("mapeia codigo %i para %s", (codigo, esperado) => {
    expect(mapSgpOsStatus(codigo)).toBe(esperado);
  });

  it("mapeia codigo desconhecido ou ausente para aberta (fallback seguro)", () => {
    expect(mapSgpOsStatus(99)).toBe(OsStatus.ABERTA);
    expect(mapSgpOsStatus(null)).toBe(OsStatus.ABERTA);
    expect(mapSgpOsStatus(undefined)).toBe(OsStatus.ABERTA);
  });

  it("aceita o codigo como string (formato comum de resposta do SGP)", () => {
    expect(mapSgpOsStatus("1")).toBe(OsStatus.CONCLUIDA);
  });
});

describe("toSgpOsStatus (ISPhub -> SGP, usado no write-back)", () => {
  it("mapeia concluida e cancelada para o codigo de encerrada (1) — SGP nao tem cancelada", () => {
    expect(toSgpOsStatus(OsStatus.CONCLUIDA)).toBe(1);
    expect(toSgpOsStatus(OsStatus.CANCELADA)).toBe(1);
  });

  it("mapeia em_execucao e pendente para seus codigos", () => {
    expect(toSgpOsStatus(OsStatus.EM_EXECUCAO)).toBe(2);
    expect(toSgpOsStatus(OsStatus.PENDENTE)).toBe(3);
  });

  it("retorna undefined para em_deslocamento (usa endpoint /acaminho/ dedicado, nao o generico)", () => {
    expect(toSgpOsStatus(OsStatus.EM_DESLOCAMENTO)).toBeUndefined();
  });
});
