import { describe, expect, it } from "vitest";
import { OsStatus } from "@isphub/shared";
import { camposEnderecoDoListado, contratosParaBackfillGeo, deveAvisarMudanca, reconciliarStatus } from "./syncService.js";

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

describe("camposEnderecoDoListado", () => {
  it("persiste os campos que a listagem traz (endereco_ll + rua presentes)", () => {
    expect(
      camposEnderecoDoListado({ logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Natal", lat: -5.79, lng: -35.21 }),
    ).toEqual({ logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Natal", lat: -5.79, lng: -35.21 });
  });

  it("NAO inclui campos ausentes (o normal na listagem) — preserva o que o backfill gravou", () => {
    // Guarda central: sem isso, todo sync zerava rua/geo que o backfill puxou
    // do cadastro do cliente, e o mapa/card viviam vazios.
    expect(camposEnderecoDoListado({ logradouro: null, numero: null, bairro: null, cidade: null, lat: null, lng: null })).toEqual(
      {},
    );
  });

  it("mantem a cidade da listagem mesmo sem rua (o SGP costuma mandar so cidade+pop)", () => {
    expect(camposEnderecoDoListado({ cidade: "Macaíba", lat: null, lng: null })).toEqual({ cidade: "Macaíba" });
  });

  it("nao persiste geo parcial (so lat ou so lng) — um par incompleto nao serve pro mapa", () => {
    expect(camposEnderecoDoListado({ lat: -5.79, lng: null })).toEqual({});
    expect(camposEnderecoDoListado({ lat: null, lng: -35.21 })).toEqual({});
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

describe("deveAvisarMudanca", () => {
  it("OS nova: avisa", () => {
    expect(deveAvisarMudanca(undefined, OsStatus.ABERTA, false)).toBe(true);
  });

  it("status mudou no SGP: avisa", () => {
    expect(deveAvisarMudanca({ status: OsStatus.ABERTA }, OsStatus.CONCLUIDA, false)).toBe(true);
  });

  it("NADA mudou: NAO avisa — senao a fila piscaria a cada ciclo de polling", () => {
    expect(deveAvisarMudanca({ status: OsStatus.ABERTA }, OsStatus.ABERTA, false)).toBe(false);
  });

  it("status protegido (acao humana recente): NAO avisa, porque o espelho nao mudou", () => {
    // O valor do SGP esta sendo ignorado de proposito nesse caso.
    expect(deveAvisarMudanca({ status: OsStatus.EM_DESLOCAMENTO }, OsStatus.ABERTA, true)).toBe(false);
  });

  it("OS nova avisa mesmo com a flag de protegido (nao ha o que proteger)", () => {
    expect(deveAvisarMudanca(undefined, OsStatus.ABERTA, true)).toBe(true);
  });
});
