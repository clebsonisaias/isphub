import { describe, expect, it } from "vitest";
import { diaBrasileiroIso, limitesDoDia, resumirDia, type ViagemDoDia } from "@isphub/shared";
import type { OcupacaoPublic } from "./ocupacaoService.js";
import { motoristaNoInstante } from "./historicoVeiculoService.js";

const v = (id: string, inicio: string, fim: string | null, extra: Partial<ViagemDoDia> = {}): ViagemDoDia => ({
  id,
  inicioEm: `2026-11-06T${inicio}:00.000Z`,
  fimEm: fim ? `2026-11-06T${fim}:00.000Z` : null,
  latInicio: 0,
  lngInicio: 0,
  latFim: Number(id),
  lngFim: Number(id),
  distanciaMetros: 1000,
  velocidadeMaxKmh: 50,
  paradoComMotorLigadoSeg: 0,
  motorista: null,
  ...extra,
});

describe("limitesDoDia", () => {
  it("o dia de Brasilia comeca as 03:00 UTC", () => {
    const { inicio, fim } = limitesDoDia("2026-11-06");
    expect(inicio.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-11-07T03:00:00.000Z");
  });
  it("23h em Brasilia ainda e o mesmo dia, mesmo ja sendo amanha em UTC", () => {
    expect(diaBrasileiroIso(new Date("2026-11-07T02:00:00Z"))).toBe("2026-11-06");
  });
});

describe("resumirDia", () => {
  const agora = new Date("2026-11-06T20:00:00Z");

  it("parada = intervalo entre viagens, no lugar onde a anterior terminou", () => {
    const r = resumirDia([v("2", "13:00", "13:30"), v("1", "11:00", "11:40")], agora);
    expect(r.viagens.map((x) => x.id)).toEqual(["1", "2"]); // ordena
    expect(r.paradas).toHaveLength(1);
    expect(r.paradas[0]).toMatchObject({ duracaoSeg: 80 * 60, lat: 1, lng: 1 });
  });

  it("liga/desliga de manobra (menos de 3 min) nao vira parada", () => {
    const r = resumirDia([v("1", "11:00", "11:10"), v("2", "11:12", "11:30")], agora);
    expect(r.paradas).toHaveLength(0);
  });

  it("soma km, tempo em movimento, marcha lenta e pega a maior velocidade", () => {
    const r = resumirDia(
      [
        v("1", "11:00", "11:30", { distanciaMetros: 12_000, velocidadeMaxKmh: 62, paradoComMotorLigadoSeg: 120 }),
        v("2", "12:00", "12:15", { distanciaMetros: 3_500, velocidadeMaxKmh: 88, paradoComMotorLigadoSeg: 60 }),
      ],
      agora,
    );
    expect(r.totais).toMatchObject({
      distanciaMetros: 15_500,
      viagens: 2,
      emMovimentoSeg: 45 * 60,
      paradoComMotorLigadoSeg: 180,
      velocidadeMaxKmh: 88,
    });
  });

  it("viagem em curso conta ate agora e nao gera parada depois dela", () => {
    const r = resumirDia([v("1", "19:30", null)], agora);
    expect(r.totais.emMovimentoSeg).toBe(30 * 60);
    expect(r.paradas).toHaveLength(0);
  });

  it("lista os motoristas do dia sem repetir, na ordem em que aparecem", () => {
    const r = resumirDia(
      [v("1", "08:00", "09:00", { motorista: "Ana" }), v("2", "10:00", "11:00", { motorista: "Rafael" }), v("3", "12:00", "13:00", { motorista: "Ana" })],
      agora,
    );
    expect(r.totais.motoristas).toEqual(["Ana", "Rafael"]);
  });

  it("dia sem viagens: tudo zerado, sem velocidade", () => {
    const r = resumirDia([], agora);
    expect(r.totais).toMatchObject({ distanciaMetros: 0, viagens: 0, velocidadeMaxKmh: null, motoristas: [] });
  });
});

describe("motoristaNoInstante", () => {
  const oc = (nome: string, papel: "motorista" | "passageiro", inicio: string, fim: string | null) =>
    ({ usuarioNome: nome, papel, inicioEm: inicio, fimEm: fim }) as OcupacaoPublic;
  const lista = [
    oc("Ana", "motorista", "2026-11-06T11:00:00Z", "2026-11-06T13:30:00Z"),
    oc("Bia", "passageiro", "2026-11-06T11:00:00Z", null),
    oc("Rafael", "motorista", "2026-11-06T13:30:00Z", null),
  ];
  it("acha o motorista cuja ocupacao cobre o instante (ignora passageiro)", () => {
    expect(motoristaNoInstante(lista, new Date("2026-11-06T12:00:00Z"))).toBe("Ana");
  });
  it("na troca exata, vale quem entrou (intervalo semiaberto)", () => {
    expect(motoristaNoInstante(lista, new Date("2026-11-06T13:30:00Z"))).toBe("Rafael");
  });
  it("ninguem declarado: nulo", () => {
    expect(motoristaNoInstante(lista, new Date("2026-11-06T09:00:00Z"))).toBeNull();
  });
});
