import { describe, expect, it } from "vitest";
import { OsStatus, SgpOsStatus } from "@isphub/shared";
import {
  camposEnderecoDoListado,
  contratosParaBackfillGeo,
  decidirSobreDesaparecida,
  deveAvisarMudanca,
  reconciliarStatus,
} from "./syncService.js";

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

describe("decidirSobreDesaparecida — quando a OS some da varredura", () => {
  const aberta = { status: OsStatus.ABERTA, ausenciasConsecutivas: 0 };

  /*
   * O TESTE QUE ESTE ARQUIVO NAO TINHA.
   *
   * Em ago/2026 o sync cancelou as OS 96770, 96799 e 96821 dizendo "nao existe
   * mais no SGP" — enquanto o SGP as devolvia na varredura do mesmo minuto. A
   * causa: a resposta da consulta individual nao era reconhecida pelo parser, e
   * "nao entendi" era representado do mesmo jeito que "nao existe".
   */
  it("NAO mexe quando nao deu pra entender a resposta do SGP", () => {
    const d = decidirSobreDesaparecida(
      { tipo: "indeterminado", motivo: "envelope nao reconhecido" },
      aberta,
    );
    expect(d.acao).toBe("nao_mexer");
  });

  it("nao cancela nem depois de MUITAS respostas indeterminadas seguidas", () => {
    // Repetir uma duvida nao a transforma em prova. Se o formato do SGP mudar,
    // a OS fica na fila para sempre — que e o lado certo de errar.
    for (const vezes of [0, 1, 2, 3, 10, 99]) {
      const d = decidirSobreDesaparecida(
        { tipo: "indeterminado", motivo: "falha na consulta: timeout" },
        { status: OsStatus.ABERTA, ausenciasConsecutivas: vezes },
      );
      expect(d.acao).toBe("nao_mexer");
    }
  });

  it("um 404 sozinho ainda nao cancela — so conta", () => {
    const d = decidirSobreDesaparecida({ tipo: "ausente" }, aberta);
    expect(d).toEqual({ acao: "contar_ausencia", vezes: 1 });
  });

  it("o segundo 404 tambem nao cancela", () => {
    const d = decidirSobreDesaparecida({ tipo: "ausente" }, { ...aberta, ausenciasConsecutivas: 1 });
    expect(d).toEqual({ acao: "contar_ausencia", vezes: 2 });
  });

  it("o terceiro 404 seguido cancela", () => {
    const d = decidirSobreDesaparecida({ tipo: "ausente" }, { ...aberta, ausenciasConsecutivas: 2 });
    expect(d.acao).toBe("fechar");
    if (d.acao === "fechar") expect(d.status).toBe(OsStatus.CANCELADA);
  });

  it("reaparecer no meio da contagem desarma o cancelamento", () => {
    // Duas ausencias acumuladas e o SGP responde que ela esta aberta: nao basta
    // "nao cancelar", tem que ZERAR — senao o proximo 404 isolado cancelaria.
    const d = decidirSobreDesaparecida(
      { tipo: "encontrada", statusBruto: 0 },
      { status: OsStatus.ABERTA, ausenciasConsecutivas: 2 },
    );
    expect(d.acao).toBe("zerar_contador");
  });

  it("encerrada no SGP fecha na hora, sem esperar repeticao", () => {
    // Aqui a evidencia e direta e positiva: o SGP disse o status, e ele e
    // fechado. Exigir 3 ciclos so deixaria OS morta entulhando a fila.
    const d = decidirSobreDesaparecida(
      { tipo: "encontrada", statusBruto: SgpOsStatus.ENCERRADA },
      aberta,
    );
    expect(d.acao).toBe("fechar");
    if (d.acao === "fechar") expect(d.status).toBe(OsStatus.CONCLUIDA);
  });

  it("OS ja cancelada aqui nao vira concluida quando o SGP diz Encerrada", () => {
    // O SGP nao separa cancelado de concluido; o espelho separa. Delega a
    // reconciliarStatus em vez de repetir a regra.
    const d = decidirSobreDesaparecida(
      { tipo: "encontrada", statusBruto: SgpOsStatus.ENCERRADA },
      { status: OsStatus.CANCELADA, ausenciasConsecutivas: 0 },
    );
    if (d.acao === "fechar") expect(d.status).toBe(OsStatus.CANCELADA);
  });
});
