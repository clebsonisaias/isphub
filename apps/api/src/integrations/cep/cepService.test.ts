import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationCache } from "../cache.js";
import { consultarCep } from "./cepService.js";

describe("Integration Hub - CEP Service", () => {
  beforeEach(() => {
    integrationCache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retorna null para CEP com tamanho inválido", async () => {
    const res = await consultarCep("123");
    expect(res).toBeNull();
  });

  it("busca e retorna endereço via BrasilAPI com sucesso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cep: "59000000",
          state: "RN",
          city: "Natal",
          neighborhood: "Tirol",
          street: "Avenida Afonso Pena",
          location: {
            coordinates: {
              latitude: "-5.79",
              longitude: "-35.20",
            },
          },
        }),
      }),
    );

    const res = await consultarCep("59000-000");
    expect(res).not.toBeNull();
    expect(res?.provedor).toBe("brasilapi");
    expect(res?.endereco.cidade).toBe("Natal");
    expect(res?.endereco.estado).toBe("RN");
    expect(res?.endereco.bairro).toBe("Tirol");
    expect(res?.endereco.lat).toBe(-5.79);
    expect(res?.endereco.lng).toBe(-35.2);
  });

  it("utiliza fallback para ViaCEP quando BrasilAPI falha (500)", async () => {
    const mockFetch = vi
      .fn()
      // 1. Falha na BrasilAPI
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      // 2. Sucesso no ViaCEP
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cep: "59000-000",
          logradouro: "Avenida Afonso Pena",
          bairro: "Tirol",
          localidade: "Natal",
          uf: "RN",
          ibge: "2408102",
        }),
      });

    vi.stubGlobal("fetch", mockFetch);

    const res = await consultarCep("59000000");
    expect(res).not.toBeNull();
    expect(res?.provedor).toBe("viacep");
    expect(res?.endereco.cidade).toBe("Natal");
    expect(res?.endereco.ibge).toBe("2408102");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("serve do cache na segunda consulta sem chamar a rede", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cep: "59000000",
        state: "RN",
        city: "Natal",
        neighborhood: "Tirol",
        street: "Avenida Afonso Pena",
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    // 1ª chamada: vai na rede
    const res1 = await consultarCep("59000-000");
    expect(res1?.provedor).toBe("brasilapi");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2ª chamada: vem do cache
    const res2 = await consultarCep("59000-000");
    expect(res2?.provedor).toBe("cache");
    expect(res2?.endereco.cidade).toBe("Natal");
    expect(mockFetch).toHaveBeenCalledTimes(1); // Não chamou fetch novamente!
  });
});
