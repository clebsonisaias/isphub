import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calcularRotaComTransito, formatarFaixaMinutos } from "./tomTomRouting.js";

describe("tomTomRouting", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  describe("formatarFaixaMinutos", () => {
    it("formata faixas curtas até 5 minutos", () => {
      expect(formatarFaixaMinutos(3)).toBe("5 a 10 minutos");
      expect(formatarFaixaMinutos(5)).toBe("5 a 10 minutos");
    });

    it("formata faixas médias de 6 a 15 minutos", () => {
      expect(formatarFaixaMinutos(10)).toBe("10 a 15 minutos");
      expect(formatarFaixaMinutos(12)).toBe("12 a 17 minutos");
    });

    it("formata faixas longas em blocos de 5 minutos", () => {
      expect(formatarFaixaMinutos(22)).toBe("20 a 25 minutos");
      expect(formatarFaixaMinutos(36)).toBe("35 a 40 minutos");
    });
  });

  describe("calcularRotaComTransito", () => {
    it("retorna null para coordenadas ausentes ou inválidas", async () => {
      expect(await calcularRotaComTransito(null, { lat: -5.8, lng: -35.2 })).toBeNull();
      expect(await calcularRotaComTransito({ lat: -5.8, lng: -35.2 }, null)).toBeNull();
      expect(await calcularRotaComTransito({ lat: 0, lng: 0 }, { lat: -5.8, lng: -35.2 })).toBeNull();
    });

    it("retorna cálculo da TomTom com trânsito ao vivo quando a API responde 200", async () => {
      const mockTomTomResponse = {
        routes: [
          {
            summary: {
              lengthInMeters: 4500,
              travelTimeInSeconds: 600, // 10 minutos
              trafficDelayInSeconds: 120, // 2 min de trânsito
            },
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTomTomResponse,
      } as any);

      const res = await calcularRotaComTransito(
        { lat: -5.81, lng: -35.21 },
        { lat: -5.83, lng: -35.21 },
      );

      expect(res).not.toBeNull();
      expect(res?.origem).toBe("tomtom_ao_vivo");
      expect(res?.distanciaMetros).toBe(4500);
      expect(res?.distanciaKm).toBe(4.5);
      expect(res?.distanciaTexto).toBe("4,5 km");
      expect(res?.tempoMinutos).toBe(10);
      expect(res?.faixaMinutos).toBe("10 a 15 minutos");
      expect(res?.atrasoTransitoSegundos).toBe(120);
    });

    it("faz fallback para cálculo local se a TomTom falhar", async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Timeout ou rede indisponível"));

      const res = await calcularRotaComTransito(
        { lat: -5.81, lng: -35.21 },
        { lat: -5.83, lng: -35.21 },
      );

      expect(res).not.toBeNull();
      expect(res?.origem).toBe("calculo_local");
      expect(res?.distanciaKm).toBeGreaterThan(0);
      expect(res?.tempoMinutos).toBeGreaterThan(0);
      expect(res?.faixaMinutos).toBeDefined();
    });
  });
});
