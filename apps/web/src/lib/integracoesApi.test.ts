import { describe, expect, it, vi } from "vitest";
import { integracoesApi } from "./integracoesApi";
import { api } from "./apiClient";

describe("integracoesApi", () => {
  it("retorna null para CEP inválido sem chamar a API", async () => {
    const spy = vi.spyOn(api, "get");
    const res = await integracoesApi.consultarCep("123");
    expect(res).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("chama endpoint correto com CEP limpo e retorna dados", async () => {
    vi.spyOn(api, "get").mockResolvedValueOnce({
      ok: true,
      provedor: "brasilapi",
      endereco: {
        cep: "59000000",
        logradouro: "Avenida Afonso Pena",
        bairro: "Tirol",
        cidade: "Natal",
        estado: "RN",
      },
    });

    const res = await integracoesApi.consultarCep("59000-000");
    expect(res).not.toBeNull();
    expect(res?.ok).toBe(true);
    expect(res?.endereco.cidade).toBe("Natal");
  });
});
