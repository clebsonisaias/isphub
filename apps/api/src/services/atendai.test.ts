import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/crypto.js", () => ({
  // Dublê transparente: o teste é sobre a DECISÃO, não sobre a cifra.
  decrypt: (v: string) => `claro:${v}`,
}));

const { credencialDe } = await import("./atendaiService.js");

const linha = (over: Partial<Parameters<typeof credencialDe>[0] & object> = {}) => ({
  baseUrl: "https://atendai.citmax.com.br",
  chaveCifrada: "ak_cifrada",
  segredoCifrado: null,
  ativo: true,
  ...over,
});

describe("credencialDe", () => {
  it("provedor SEM config devolve null — nao e erro, e quem nao contratou", () => {
    // Se isto lancasse, todo provedor sem AtendAI veria excecao no caminho
    // normal de conversa. O null e o que permite cair no canal proprio.
    expect(credencialDe(null)).toBeNull();
  });

  it("config DESATIVADA se comporta igual a config ausente", () => {
    // Desligar tem que ter o efeito de nunca ter ligado. Se desse um terceiro
    // resultado, viraria um estado que nenhum chamador previu.
    expect(credencialDe(linha({ ativo: false }))).toBeNull();
  });

  it("tira a barra final da baseUrl — senao a URL sai com // no meio", () => {
    expect(credencialDe(linha({ baseUrl: "https://a.b/" }))?.baseUrl).toBe("https://a.b");
    expect(credencialDe(linha({ baseUrl: "https://a.b///" }))?.baseUrl).toBe("https://a.b");
  });

  it("decifra a chave e o segredo", () => {
    const c = credencialDe(linha({ segredoCifrado: "seg_cifrado" }));
    expect(c?.chave).toBe("claro:ak_cifrada");
    expect(c?.segredo).toBe("claro:seg_cifrado");
  });

  it("sem segredo de webhook, `segredo` e null e nao string vazia", () => {
    // O receptor do webhook decide "posso validar assinatura?" por este campo.
    // "" seria falsy tambem, mas passaria por decrypt e poderia explodir.
    expect(credencialDe(linha())?.segredo).toBeNull();
  });
});
