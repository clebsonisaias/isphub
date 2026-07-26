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

  // Regressao real de producao: o SGP da CITmax manda o rotulo em "status"
  // ("Encerrada") e o codigo em "status_id". O conector lia o texto, Number()
  // virava NaN, e o switch caia no default — marcando TODA OS como "aberta".
  // Resultado observado: 1258 abertas / 0 concluidas no espelho, com OS
  // comprovadamente encerradas no SGP aparecendo como abertas no ISPhub.
  describe("rotulo textual (payload real do SGP)", () => {
    it.each([
      ["Encerrada", OsStatus.CONCLUIDA],
      ["encerrada", OsStatus.CONCLUIDA],
      ["Finalizada", OsStatus.CONCLUIDA],
      ["Concluída", OsStatus.CONCLUIDA],
      ["Aberta", OsStatus.ABERTA],
      ["Pendente", OsStatus.PENDENTE],
      ["Cancelada", OsStatus.CANCELADA],
    ])("mapeia %s para %s", (texto, esperado) => {
      expect(mapSgpOsStatus(texto)).toBe(esperado);
    });

    it("entende 'Em execução' com e sem acento", () => {
      expect(mapSgpOsStatus("Em execução")).toBe(OsStatus.EM_EXECUCAO);
      expect(mapSgpOsStatus("Em execucao")).toBe(OsStatus.EM_EXECUCAO);
    });

    it("nao confunde texto vazio com status valido", () => {
      expect(mapSgpOsStatus("")).toBe(OsStatus.ABERTA);
      expect(mapSgpOsStatus("   ")).toBe(OsStatus.ABERTA);
    });
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
