import { describe, expect, it } from "vitest";
import { selecionarOsParaAlertar, type OsParaAvaliarSla } from "./slaAlertService.js";

const AGORA = new Date("2026-07-26T12:00:00.000Z");

function os(overrides: Partial<OsParaAvaliarSla>): OsParaAvaliarSla {
  return {
    id: "os-1",
    tecnicoId: null,
    dataAgendamento: null,
    dataCadastro: null,
    criadoEm: AGORA,
    slaHoras: null,
    ...overrides,
  };
}

describe("selecionarOsParaAlertar", () => {
  it("ignora OS sem SLA definido (tipo sem slaHoras e sem categoria com padrao)", () => {
    const ordens = [os({ slaHoras: null, dataAgendamento: new Date("2026-07-20T00:00:00.000Z") })];
    expect(selecionarOsParaAlertar(ordens, AGORA)).toEqual([]);
  });

  it("ignora OS ainda dentro do prazo", () => {
    const ordens = [os({ slaHoras: 24, dataAgendamento: new Date("2026-07-26T06:00:00.000Z") })]; // vence as 06:00 do dia 27, 6h atras de vencer
    expect(selecionarOsParaAlertar(ordens, AGORA)).toEqual([]);
  });

  it("seleciona OS com o semaforo vermelho (prazo ja estourado)", () => {
    const estourada = os({ id: "os-vermelha", slaHoras: 24, dataAgendamento: new Date("2026-07-24T00:00:00.000Z") });
    const dentroDoPrazo = os({ id: "os-verde", slaHoras: 24, dataAgendamento: new Date("2026-07-26T10:00:00.000Z") });
    const resultado = selecionarOsParaAlertar([estourada, dentroDoPrazo], AGORA);
    expect(resultado.map((o) => o.id)).toEqual(["os-vermelha"]);
  });

  it("usa dataCadastro/criadoEm como fallback quando nao ha dataAgendamento", () => {
    const ordens = [os({ slaHoras: 8, dataAgendamento: null, dataCadastro: new Date("2026-07-25T00:00:00.000Z") })];
    expect(selecionarOsParaAlertar(ordens, AGORA)).toHaveLength(1);
  });

  it("retorna lista vazia quando nao ha nenhuma OS estourada", () => {
    const ordens = [
      os({ slaHoras: 48, dataAgendamento: new Date("2026-07-26T11:00:00.000Z") }),
      os({ id: "os-2", slaHoras: null }),
    ];
    expect(selecionarOsParaAlertar(ordens, AGORA)).toEqual([]);
  });
});
