import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationCache } from "../cache.js";
import { listarMunicipios, listarUfs } from "./ibgeService.js";
import { listarFeriados } from "../feriados/feriadosService.js";

describe("Integration Hub - IBGE e Feriados", () => {
  beforeEach(() => {
    integrationCache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listarUfs busca e formata UFs com cache", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 24, sigla: "RN", nome: "Rio Grande do Norte" },
        { id: 25, sigla: "PB", nome: "Paraíba" },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    const ufs = await listarUfs();
    expect(ufs).toHaveLength(2);
    expect(ufs[0].sigla).toBe("RN");

    // Segunda chamada vem do cache
    const ufsCache = await listarUfs();
    expect(ufsCache).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("listarMunicipios valida UF e faz cache por estado", async () => {
    expect(await listarMunicipios("")).toEqual([]);
    expect(await listarMunicipios("ABC")).toEqual([]);

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 2408102, nome: "Natal" },
        { id: 2408003, nome: "Mossoró" },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    const municipios = await listarMunicipios("rn");
    expect(municipios).toHaveLength(2);
    expect(municipios[0].nome).toBe("Natal");
  });

  it("listarFeriados valida ano e busca feriados nacionais", async () => {
    expect(await listarFeriados(1800)).toEqual([]);

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { date: "2026-01-01", name: "Confraternização Universal", type: "national" },
        { date: "2026-04-21", name: "Tiradentes", type: "national" },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    const feriados = await listarFeriados(2026);
    expect(feriados).toHaveLength(2);
    expect(feriados[1].name).toBe("Tiradentes");
  });
});
