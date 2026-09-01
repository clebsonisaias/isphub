import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `token-store` puxa react-native e expo-secure-store, que nao carregam fora
 * do aparelho. O `vi.mock` com fabrica substitui o modulo ANTES de ele ser
 * lido, entao a fonte Flow da RN nunca chega no parser — que e o que quebraria
 * o runner sem chance de mock nenhum salvar depois.
 */
const guardado = new Map<string, string>();
vi.mock("./token-store", () => ({
  tokenStore: {
    get: async (k: string) => guardado.get(k) ?? null,
    set: async (k: string, v: string) => void guardado.set(k, v),
    del: async (k: string) => void guardado.delete(k),
  },
}));

import { getAccessToken, getRefreshToken, renovarSessao, setSessao } from "./sessao";

describe("renovarSessao", () => {
  beforeEach(() => {
    guardado.clear();
    vi.unstubAllGlobals();
    setSessao("velho", "refresh-1");
  });

  it("N chamadas simultaneas fazem UMA rotacao so", async () => {
    /*
     * O refresh e ROTATIVO: a segunda chamada apresentaria um token que a
     * primeira acabou de queimar. O servidor tem 30s de graca pra isso, mas
     * fora da janela ele interpreta como token clonado e derruba TODAS as
     * sessoes do usuario. O custo do descuido do cliente e o tecnico deslogado
     * no campo — por isso a renovacao e unica e compartilhada.
     */
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => {
      chamadas++;
      return { ok: true, status: 200, json: async () => ({ token: "novo", refreshToken: "refresh-2" }) };
    });

    const [a, b, c] = await Promise.all([renovarSessao(), renovarSessao(), renovarSessao()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(chamadas).toBe(1);
    expect(getAccessToken()).toBe("novo");
    expect(getRefreshToken()).toBe("refresh-2");
  });

  it("depois de terminar, uma nova renovacao roda de novo (nao fica presa)", async () => {
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => {
      chamadas++;
      return { ok: true, status: 200, json: async () => ({ token: `t${chamadas}`, refreshToken: `r${chamadas}` }) };
    });
    await renovarSessao();
    await renovarSessao();
    expect(chamadas).toBe(2);
  });

  it("falha de REDE nao apaga a sessao", async () => {
    // Sem sinal no meio do mato nao e sessao invalida. Apagar aqui deslogaria
    // o tecnico exatamente quando ele nao tem como logar de novo.
    vi.stubGlobal("fetch", async () => {
      throw new Error("sem rede");
    });
    expect(await renovarSessao()).toBe(false);
    expect(getAccessToken()).toBe("velho");
    expect(getRefreshToken()).toBe("refresh-1");
  });

  it("401 do servidor apaga a sessao — ai sim ela morreu de verdade", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await renovarSessao()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("sem refresh guardado nao tenta nada", async () => {
    setSessao("velho", null);
    let chamou = false;
    vi.stubGlobal("fetch", async () => {
      chamou = true;
      return { ok: true, status: 200, json: async () => ({}) };
    });
    expect(await renovarSessao()).toBe(false);
    expect(chamou).toBe(false);
  });

  it("resposta 200 sem token no corpo nao passa por sucesso", async () => {
    // Um 200 malformado nao pode virar "renovou": o app seguiria com o token
    // velho achando que renovou, e o proximo 401 nao teria mais o que tentar.
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await renovarSessao()).toBe(false);
  });
});

describe("setSessao", () => {
  it("avisa quem assinou quando o access muda", async () => {
    const { assinarMudanca } = await import("./sessao");
    const vistos: (string | null)[] = [];
    const cancelar = assinarMudanca((t) => vistos.push(t));
    setSessao("a", "r");
    setSessao(null, null);
    cancelar();
    setSessao("depois-de-cancelar", "r");
    expect(vistos).toEqual(["a", null]);
  });
});
