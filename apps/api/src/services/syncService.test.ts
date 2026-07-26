import { describe, expect, it } from "vitest";
import { OsStatus } from "@isphub/shared";
import { reconciliarStatus } from "./syncService.js";

describe("reconciliarStatus", () => {
  it("mantem Cancelada quando o SGP diz Concluida (SGP so tem 'Encerrada', sem distinguir cancelado)", () => {
    expect(reconciliarStatus(OsStatus.CONCLUIDA, OsStatus.CANCELADA)).toBe(OsStatus.CANCELADA);
  });

  it("mantem A caminho quando o SGP ainda diz Aberta (SGP nao tem status pra 'a caminho')", () => {
    expect(reconciliarStatus(OsStatus.ABERTA, OsStatus.EM_DESLOCAMENTO)).toBe(OsStatus.EM_DESLOCAMENTO);
  });

  it("sobrescreve A caminho quando o SGP mostra progresso real (Em execucao)", () => {
    expect(reconciliarStatus(OsStatus.EM_EXECUCAO, OsStatus.EM_DESLOCAMENTO)).toBe(OsStatus.EM_EXECUCAO);
  });

  it("sobrescreve Cancelada quando o SGP diz Em execucao (nao e o caso ambiguo Encerrada/Concluida)", () => {
    expect(reconciliarStatus(OsStatus.EM_EXECUCAO, OsStatus.CANCELADA)).toBe(OsStatus.EM_EXECUCAO);
  });

  it("usa o status do SGP normalmente quando nao ha OS local (primeira sincronizacao)", () => {
    expect(reconciliarStatus(OsStatus.ABERTA, undefined)).toBe(OsStatus.ABERTA);
  });

  it("usa o status do SGP normalmente pra OS aberta comum, sem conflito", () => {
    expect(reconciliarStatus(OsStatus.CONCLUIDA, OsStatus.ABERTA)).toBe(OsStatus.CONCLUIDA);
  });
});
