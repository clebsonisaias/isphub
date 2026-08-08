import { describe, expect, it } from "vitest";
import { segmentarViagens, type PontoViagem } from "@isphub/shared";

/** Base em Macaiba/RN — onde a HFX-3652 opera de verdade. */
const BASE = { lat: -5.8567, lng: -35.3536 };

function p(minuto: number, ignicao: boolean | null, opts: { dx?: number; kmh?: number } = {}): PontoViagem {
  return {
    lat: BASE.lat,
    lng: BASE.lng + (opts.dx ?? 0),
    em: new Date(Date.UTC(2026, 7, 8, 11, minuto, 0)),
    ignicao,
    velocidadeKmh: opts.kmh ?? 0,
  };
}

describe("segmentarViagens", () => {
  it("serie vazia nao inventa viagem", () => {
    expect(segmentarViagens([])).toEqual([]);
  });

  it("carro parado o dia todo nao gera viagem", () => {
    expect(segmentarViagens([p(0, false), p(10, false), p(20, false)])).toEqual([]);
  });

  it("ligou e desligou vira UMA viagem fechada", () => {
    const v = segmentarViagens([p(0, false), p(1, true), p(5, true, { dx: 0.01 }), p(9, false, { dx: 0.02 })]);
    expect(v).toHaveLength(1);
    expect(v[0]!.inicioEm.getUTCMinutes()).toBe(1);
    expect(v[0]!.fimEm?.getUTCMinutes()).toBe(9);
    expect(v[0]!.pontos).toBe(3);
    expect(v[0]!.distanciaMetros).toBeGreaterThan(1000);
  });

  it("o ponto de ignicao desligada FECHA a viagem e conta no trajeto", () => {
    // Fechar no ponto anterior perderia o ultimo trecho — que costuma ser
    // exatamente a chegada no cliente.
    const comUltimo = segmentarViagens([p(0, true), p(5, true, { dx: 0.01 }), p(6, false, { dx: 0.05 })]);
    const semUltimo = segmentarViagens([p(0, true), p(5, true, { dx: 0.01 })]);
    expect(comUltimo[0]!.distanciaMetros).toBeGreaterThan(semUltimo[0]!.distanciaMetros);
    expect(comUltimo[0]!.lngFim).toBeCloseTo(BASE.lng + 0.05, 6);
  });

  it("duas viagens no mesmo dia", () => {
    const v = segmentarViagens([
      p(0, true),
      p(5, true, { dx: 0.01 }),
      p(8, false, { dx: 0.01 }),
      p(20, false, { dx: 0.01 }),
      p(25, true, { dx: 0.01 }),
      p(30, false, { dx: 0.03 }),
    ]);
    expect(v).toHaveLength(2);
    expect(v[0]!.fimEm?.getUTCMinutes()).toBe(8);
    expect(v[1]!.inicioEm.getUTCMinutes()).toBe(25);
  });

  it("viagem ainda em curso fica com fimEm null", () => {
    // O carro esta rodando AGORA. Carimbar o ultimo ponto como fim mentiria
    // dizendo que ja chegou.
    const v = segmentarViagens([p(0, true), p(5, true, { dx: 0.01, kmh: 60 })]);
    expect(v).toHaveLength(1);
    expect(v[0]!.fimEm).toBeNull();
    expect(v[0]!.velocidadeMaxKmh).toBe(60);
  });

  it("velocidade maxima e o pico da viagem", () => {
    const v = segmentarViagens([
      p(0, true, { kmh: 10 }),
      p(2, true, { dx: 0.01, kmh: 87 }),
      p(4, true, { dx: 0.02, kmh: 40 }),
      p(6, false, { dx: 0.02, kmh: 0 }),
    ]);
    expect(v[0]!.velocidadeMaxKmh).toBe(87);
  });

  it("conta o tempo parado COM O MOTOR LIGADO", () => {
    // 11:00 anda, 11:05 para, 11:20 ainda parado, 11:22 volta a andar.
    // Entre 11:05 e 11:20 sao 15 minutos de combustivel queimado a toa.
    const v = segmentarViagens([
      p(0, true, { kmh: 50 }),
      p(5, true, { dx: 0.01, kmh: 0 }),
      p(20, true, { dx: 0.01, kmh: 1 }),
      p(22, true, { dx: 0.02, kmh: 45 }),
      p(25, false, { dx: 0.03, kmh: 0 }),
    ]);
    expect(v[0]!.paradoComMotorLigadoSeg).toBe(15 * 60);
  });

  it("carro em movimento nao acumula tempo parado", () => {
    const v = segmentarViagens([
      p(0, true, { kmh: 50 }),
      p(10, true, { dx: 0.05, kmh: 60 }),
      p(20, false, { dx: 0.1, kmh: 0 }),
    ]);
    expect(v[0]!.paradoComMotorLigadoSeg).toBe(0);
  });

  it("buraco longo na serie encerra a viagem no ultimo ponto conhecido", () => {
    // Rastreador saiu do ar as 11:05 e voltou as 12:05. Sem o corte, sairia uma
    // viagem de uma hora com uma reta atravessando a cidade — e o relatorio de
    // km diria que o carro rodou o que nunca rodou.
    const v = segmentarViagens([p(0, true), p(5, true, { dx: 0.01 }), p(65, true, { dx: 0.5 })]);
    expect(v).toHaveLength(2);
    expect(v[0]!.fimEm?.getUTCMinutes()).toBe(5);
    expect(v[1]!.fimEm).toBeNull();
    expect(v[1]!.pontos).toBe(1);
  });

  it("ignicao desconhecida NAO abre nem fecha viagem", () => {
    // O aparelho nao mandou ACC. Isso nao e "ligou" nem "desligou".
    expect(segmentarViagens([p(0, null), p(5, null), p(10, null)])).toEqual([]);
  });

  it("ignicao desconhecida no meio da viagem entra na trilha sem fecha-la", () => {
    const v = segmentarViagens([
      p(0, true),
      p(3, null, { dx: 0.01, kmh: 55 }),
      p(6, true, { dx: 0.02 }),
      p(9, false, { dx: 0.03 }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]!.pontos).toBe(4);
    expect(v[0]!.velocidadeMaxKmh).toBe(55);
  });

  it("desligar sem ter ligado nao cria viagem do nada", () => {
    expect(segmentarViagens([p(0, false), p(5, false)])).toEqual([]);
  });

  it("respeita o limiar de parado configurado", () => {
    const pontos = [p(0, true, { kmh: 5 }), p(10, true, { dx: 0.001, kmh: 5 }), p(12, false, { dx: 0.001 })];
    expect(segmentarViagens(pontos).at(0)!.paradoComMotorLigadoSeg).toBe(0);
    expect(segmentarViagens(pontos, { velocidadeParadoKmh: 8 }).at(0)!.paradoComMotorLigadoSeg).toBe(10 * 60);
  });
});
