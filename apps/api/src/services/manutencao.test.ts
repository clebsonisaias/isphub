import { describe, expect, it } from "vitest";
import { estadoManutencao } from "@isphub/shared";

const hoje = new Date("2026-10-08T12:00:00Z");

describe("estadoManutencao — por km, por dias, o que vier primeiro", () => {
  it("por km: ok longe, 'em breve' a 500 km, vencida ao passar", () => {
    const oleo = { intervaloKm: 10_000, intervaloDias: null, ultimaKm: 50_000, ultimaEm: null };
    expect(estadoManutencao(oleo, 55_000, hoje)).toMatchObject({ situacao: "ok", restanteKm: 5000 });
    expect(estadoManutencao(oleo, 59_600, hoje)).toMatchObject({ situacao: "vence_em_breve", restanteKm: 400 });
    expect(estadoManutencao(oleo, 60_320, hoje)).toMatchObject({ situacao: "vencida", restanteKm: -320 });
  });

  it("por dias: revisao anual vence pelo calendario mesmo com km folgado", () => {
    const revisao = { intervaloKm: 20_000, intervaloDias: 365, ultimaKm: 10_000, ultimaEm: "2025-09-01T12:00:00Z" };
    const e = estadoManutencao(revisao, 12_000, hoje);
    expect(e.situacao).toBe("vencida");
    expect(e.restanteKm).toBe(18_000);
    expect(e.restanteDias).toBeLessThan(0);
  });

  it("sem 'ultima' por km, conta do zero do odometro; sem odometro nem data, sem_base", () => {
    expect(estadoManutencao({ intervaloKm: 10_000, intervaloDias: null, ultimaKm: null, ultimaEm: null }, 9_000, hoje)).toMatchObject({ situacao: "vence_em_breve", restanteKm: 1000 });
    expect(estadoManutencao({ intervaloKm: 10_000, intervaloDias: null, ultimaKm: null, ultimaEm: null }, null, hoje).situacao).toBe("sem_base");
  });
});
