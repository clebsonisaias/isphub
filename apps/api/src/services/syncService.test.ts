import { describe, expect, it } from "vitest";
import { OsStatus } from "@isphub/shared";
import { camposGeoDoListado, contratosParaBackfillGeo, reconciliarStatus } from "./syncService.js";

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

describe("camposGeoDoListado", () => {
  it("persiste lat/lng quando a listagem traz coordenada (endereco_ll presente)", () => {
    expect(camposGeoDoListado({ lat: -5.79, lng: -35.21 })).toEqual({ lat: -5.79, lng: -35.21 });
  });

  it("NAO seta lat/lng quando a listagem nao traz coordenada (o normal) — preserva a geo do backfill", () => {
    // Guarda central do mapa: sem isso, todo sync zerava a coordenada que o
    // backfill puxou do cadastro do cliente e o mapa vivia vazio.
    expect(camposGeoDoListado({ lat: null, lng: null })).toEqual({});
  });

  it("nao persiste geo parcial (so lat ou so lng) — um par incompleto nao serve pro mapa", () => {
    expect(camposGeoDoListado({ lat: -5.79, lng: null })).toEqual({});
    expect(camposGeoDoListado({ lat: null, lng: -35.21 })).toEqual({});
  });
});

describe("contratosParaBackfillGeo", () => {
  it("deduplica contratos (varias OS do mesmo contrato viram uma consulta so)", () => {
    const candidatas = [{ contratoId: "A" }, { contratoId: "A" }, { contratoId: "B" }, { contratoId: "A" }];
    expect(contratosParaBackfillGeo(candidatas, 30)).toEqual(["A", "B"]);
  });

  it("respeita o teto por ciclo (espalha o backfill por varios syncs)", () => {
    const candidatas = [{ contratoId: "A" }, { contratoId: "B" }, { contratoId: "C" }];
    expect(contratosParaBackfillGeo(candidatas, 2)).toEqual(["A", "B"]);
  });

  it("ignora OS sem contrato (nao da pra consultar geo sem contratoId)", () => {
    const candidatas = [{ contratoId: null }, { contratoId: "A" }, { contratoId: null }];
    expect(contratosParaBackfillGeo(candidatas, 30)).toEqual(["A"]);
  });

  it("retorna vazio quando nao ha candidatas", () => {
    expect(contratosParaBackfillGeo([], 30)).toEqual([]);
  });
});
