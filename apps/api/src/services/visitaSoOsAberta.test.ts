import { describe, expect, it } from "vitest";
import { OsStatus } from "@isphub/shared";
import { motivoSemVisita } from "./agendaService.js";

describe("visita só para OS aberta (qualquer tipo)", () => {
  it("OS espelhada: aberta, em deslocamento, em execução e pendente podem; concluída e cancelada não", () => {
    for (const s of [OsStatus.ABERTA, OsStatus.EM_DESLOCAMENTO, OsStatus.EM_EXECUCAO, OsStatus.PENDENTE]) {
      expect(motivoSemVisita(s, null)).toBeNull();
    }
    expect(motivoSemVisita(OsStatus.CONCLUIDA, null)).toMatch(/encerrada/);
    expect(motivoSemVisita(OsStatus.CANCELADA, null)).toMatch(/encerrada/);
  });

  it("OS que ainda não chegou ao espelho: o SGP decide", () => {
    expect(motivoSemVisita(null, { tipo: "encontrada", statusBruto: 0 })).toBeNull(); // 0 = aberta no SGP
    expect(motivoSemVisita(null, { tipo: "encontrada", statusBruto: 1 })).toMatch(/encerrada no SGP/);
    expect(motivoSemVisita(null, { tipo: "ausente" })).toMatch(/não existe/);
  });

  it("SGP fora do ar ou não consultado não trava a marcação", () => {
    expect(motivoSemVisita(null, { tipo: "indeterminado", motivo: "timeout" })).toBeNull();
    expect(motivoSemVisita(null, null)).toBeNull();
  });
});
