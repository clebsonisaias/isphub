import { describe, expect, it } from "vitest";
import {
  duracaoTrabalhada,
  formatarTrabalhado,
  msEmPausa,
  pausaAberta,
  type PausaJornada,
} from "@isphub/shared";

const INICIO = "2026-09-01T07:00:00.000Z";
const em = (h: number, m = 0) => new Date(Date.parse(INICIO) + h * 3_600_000 + m * 60_000);
const pausa = (de: number, ate: number | null, motivo: PausaJornada["motivo"] = "almoco"): PausaJornada => ({
  id: `p${de}`,
  inicioEm: em(de).toISOString(),
  fimEm: ate === null ? null : em(ate).toISOString(),
  motivo,
});

describe("msEmPausa", () => {
  it("sem pausa, zero", () => {
    expect(msEmPausa([], em(8))).toBe(0);
  });

  it("uma pausa fechada de 1h conta 1h", () => {
    expect(msEmPausa([pausa(5, 6)], em(9))).toBe(3_600_000);
  });

  it("soma pausas separadas", () => {
    expect(msEmPausa([pausa(3, 4), pausa(5, 6)], em(9))).toBe(2 * 3_600_000);
  });

  it("pausa ABERTA corre ate agora — senao o contador congela justo durante o almoco", () => {
    expect(msEmPausa([pausa(5, null)], em(6, 30))).toBe(90 * 60_000);
  });

  it("nao conta o que ainda nao aconteceu (pausa fechada depois de `ate`)", () => {
    // Uma pausa das 5h as 6h, olhada as 5h30, so pode valer 30min.
    expect(msEmPausa([pausa(5, 6)], em(5, 30))).toBe(30 * 60_000);
  });

  it("relogio torto nao gera tempo NEGATIVO — viraria tempo trabalhado a mais", () => {
    // Pausa carimbada no futuro em relacao a `ate`.
    expect(msEmPausa([pausa(9, 10)], em(8))).toBe(0);
  });

  it("data invalida e ignorada em vez de virar NaN e contaminar o total", () => {
    const ruim: PausaJornada = { id: "x", inicioEm: "nao-e-data", fimEm: null, motivo: "outro" };
    expect(msEmPausa([ruim, pausa(5, 6)], em(9))).toBe(3_600_000);
  });
});

describe("duracaoTrabalhada", () => {
  it("desconta a pausa do decorrido", () => {
    // 9h de jornada com 1h de almoco = 8h trabalhadas.
    expect(duracaoTrabalhada(INICIO, [pausa(4, 5)], em(9))).toMatchObject({ horas: 8, minutos: 0 });
  });

  it("sem pausa e igual ao decorrido", () => {
    expect(duracaoTrabalhada(INICIO, [], em(5, 58))).toMatchObject({ horas: 5, minutos: 58 });
  });

  it("nunca fica negativo, mesmo com pausa maior que o decorrido", () => {
    expect(duracaoTrabalhada(INICIO, [pausa(0, 10)], em(2)).ms).toBe(0);
  });

  it("formata com zero a esquerda igual ao irmao", () => {
    expect(formatarTrabalhado(INICIO, [pausa(4, 5)], em(9, 7))).toBe("8h07");
  });
});

describe("pausaAberta", () => {
  it("acha a que nao tem fim", () => {
    expect(pausaAberta([pausa(3, 4), pausa(5, null)])?.id).toBe("p5");
  });
  it("devolve null quando todas fecharam", () => {
    expect(pausaAberta([pausa(3, 4)])).toBeNull();
  });
});
