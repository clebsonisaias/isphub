import { describe, expect, it } from "vitest";
import { densidadeSuficiente, medirDeslocamento, metrosDaOrdem, sugerirOrdem } from "@isphub/shared";

const p = (lat: number, lng: number, em = "2026-10-08T10:00:00.000Z") => ({ lat, lng, em });

describe("medirDeslocamento — km ate a OS", () => {
  it("com serie de posicoes, soma os trechos em ordem de tempo (GPS)", () => {
    // ~1,11 km por 0,01 grau de latitude; fora de ordem de proposito.
    const m = medirDeslocamento({
      posicoes: [p(-5.80, -35.20, "2026-10-08T10:10:00Z"), p(-5.78, -35.20, "2026-10-08T10:00:00Z"), p(-5.79, -35.20, "2026-10-08T10:05:00Z")],
    });
    expect(m.fonte).toBe("gps");
    expect(m.pontos).toBe(3);
    expect(m.metros).toBeGreaterThan(2100);
    expect(m.metros).toBeLessThan(2300);
  });

  it("sem serie, estima pela reta x fator de rua entre a parada anterior e o endereco", () => {
    const m = medirDeslocamento({ posicoes: [], origemFallback: { lat: -5.78, lng: -35.2 }, destinoFallback: { lat: -5.79, lng: -35.2 } });
    expect(m.fonte).toBe("estimado");
    expect(m.metros).toBeGreaterThan(1400); // 1,1 km x 1,3
    expect(m.metros).toBeLessThan(1500);
  });

  it("sem serie e sem coordenadas, declara sem_dados — nunca zero disfarcado", () => {
    expect(medirDeslocamento({ posicoes: [p(-5.8, -35.2)] })).toMatchObject({ fonte: "sem_dados", metros: 0, pontos: 1 });
  });

  it("densidade: 1 ponto a cada 3 min basta; menos que isso pede historico", () => {
    const de = new Date("2026-10-08T10:00:00Z");
    const ate = new Date("2026-10-08T10:30:00Z");
    expect(densidadeSuficiente(10, de, ate)).toBe(true);
    expect(densidadeSuficiente(4, de, ate)).toBe(false);
  });
});

describe("sugerirOrdem — rota por proximidade", () => {
  const base = { lat: -5.80, lng: -35.20 };
  it("poe as paradas na ordem de distancia a partir da base e devolve o percurso", () => {
    const s = sugerirOrdem(
      [
        { id: "longe", lat: -5.70, lng: -35.20 },
        { id: "perto", lat: -5.79, lng: -35.20 },
        { id: "medio", lat: -5.75, lng: -35.20 },
      ],
      base,
    );
    expect(s.ordem).toEqual(["perto", "medio", "longe"]);
    expect(s.metros).toBeGreaterThan(11_000);
    expect(s.semCoordenada).toBe(0);
  });

  it("quem nao tem coordenada vai pro fim, na ordem em que veio", () => {
    const s = sugerirOrdem(
      [
        { id: "sem-1", lat: null, lng: null },
        { id: "b", lat: -5.70, lng: -35.20 },
        { id: "sem-2", lat: null, lng: null },
        { id: "a", lat: -5.79, lng: -35.20 },
      ],
      base,
    );
    expect(s.ordem).toEqual(["a", "b", "sem-1", "sem-2"]);
    expect(s.semCoordenada).toBe(2);
  });

  it("2-opt: a sugestao nunca e mais longa que a ordem original", () => {
    // Quadrado com a ordem original cruzando as diagonais.
    const paradas = [
      { id: "ne", lat: -5.70, lng: -35.10 },
      { id: "so", lat: -5.80, lng: -35.20 },
      { id: "no", lat: -5.70, lng: -35.20 },
      { id: "se", lat: -5.80, lng: -35.10 },
    ];
    const s = sugerirOrdem(paradas, null);
    expect(s.metros).toBeLessThan(metrosDaOrdem(paradas, null));
  });

  it("sem origem e sem coordenada nenhuma, devolve a ordem original e zero metros", () => {
    const s = sugerirOrdem([{ id: "x", lat: null, lng: null }], null);
    expect(s).toEqual({ ordem: ["x"], metros: 0, semCoordenada: 1 });
  });
});
