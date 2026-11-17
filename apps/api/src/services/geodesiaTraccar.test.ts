import { describe, expect, it } from "vitest";
import { filtrarRuidoGps, pontoDentroDaCerca } from "@isphub/shared";

describe("filtrarRuidoGps", () => {
  it("remove coordenadas inválidas (0,0) e saltos impossíveis", () => {
    const pontos = [
      { lat: 0, lng: 0, em: "2026-11-16T10:00:00Z", velocidadeKmh: 0 },
      { lat: -5.8548, lng: -35.3574, em: "2026-11-16T10:01:00Z", velocidadeKmh: 20 },
      // Salto de ~11 km em 10 segundos (~3960 km/h) -> teleporte
      { lat: -5.7548, lng: -35.3574, em: "2026-11-16T10:01:10Z", velocidadeKmh: 20 },
      { lat: -5.8550, lng: -35.3575, em: "2026-11-16T10:02:00Z", velocidadeKmh: 25 },
    ];
    const filtrados = filtrarRuidoGps(pontos);
    expect(filtrados).toHaveLength(2);
    expect(filtrados[0]!.lat).toBeCloseTo(-5.8548, 4);
    expect(filtrados[1]!.lat).toBeCloseTo(-5.855, 4);
  });

  it("remove jitter estacionário intermediário mas preserva o último ponto", () => {
    const pontos = [
      { lat: -5.8548, lng: -35.3574, em: "2026-11-16T10:00:00Z", velocidadeKmh: 0 },
      { lat: -5.85481, lng: -35.35741, em: "2026-11-16T10:01:00Z", velocidadeKmh: 0 },
      { lat: -5.85482, lng: -35.35742, em: "2026-11-16T10:02:00Z", velocidadeKmh: 0 },
    ];
    const filtrados = filtrarRuidoGps(pontos);
    expect(filtrados).toHaveLength(2);
    expect(filtrados[1]!.em).toBe("2026-11-16T10:02:00Z");
  });
});

describe("pontoDentroDaCerca", () => {
  it("detecta ponto dentro e fora de cerca circular", () => {
    const cerca = { tipo: "circulo" as const, centroLat: -5.8548, centroLng: -35.3574, raioMetros: 200 };
    expect(pontoDentroDaCerca({ lat: -5.8549, lng: -35.3575 }, cerca)).toBe(true);
    expect(pontoDentroDaCerca({ lat: -5.8600, lng: -35.3574 }, cerca)).toBe(false);
  });

  it("detecta ponto dentro e fora de cerca poligonal", () => {
    const cerca = {
      tipo: "poligono" as const,
      vertices: [
        { lat: -5.86, lng: -35.36 },
        { lat: -5.86, lng: -35.35 },
        { lat: -5.85, lng: -35.35 },
        { lat: -5.85, lng: -35.36 },
      ],
    };
    expect(pontoDentroDaCerca({ lat: -5.855, lng: -35.355 }, cerca)).toBe(true);
    expect(pontoDentroDaCerca({ lat: -5.87, lng: -35.355 }, cerca)).toBe(false);
  });
});
