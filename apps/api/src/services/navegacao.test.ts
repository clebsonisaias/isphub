import { describe, expect, it } from "vitest";
import { linkWaze } from "@isphub/shared";

/*
 * Mora no workspace da API porque nem `shared` nem `apps/mobile` tem vitest,
 * e acrescentar a ferramenta so por isto seria custo sem retorno. O import e de
 * `@isphub/shared`, entao e a funcao publicada que esta sob teste.
 */

/*
 * O link e puro de proposito: e a unica parte desta feature que da pra errar
 * em silencio. Um `waze://` ou um endereco mal codificado nao estoura — o botao
 * so nao faz nada, e ninguem descobre ate um tecnico reclamar da rua.
 */

describe("linkWaze", () => {
  it("com coordenada, navega direto pro ponto", () => {
    expect(linkWaze({ lat: -5.79, lng: -35.2 })).toBe("https://waze.com/ul?ll=-5.79,-35.2&navigate=yes");
  });

  it("usa https, NUNCA o esquema waze://", () => {
    /*
     * `waze://` falha em silencio em aparelho sem o app instalado: o Linking
     * rejeita e o botao vira decoracao. O universal link abre o app quando ele
     * existe e a web quando nao.
     */
    const l = linkWaze({ lat: 1, lng: 2 });
    expect(l.startsWith("https://")).toBe(true);
    expect(l).not.toContain("waze://");
  });

  it("sem coordenada, manda o endereco por texto", () => {
    // Comum, nao excecao: a listagem de OS do SGP nao traz geo — so o backfill
    // do cadastro preenche, e nem sempre consegue.
    expect(linkWaze({ logradouro: "Rua Exemplo", numero: "245", bairro: "Centro", cidade: "Natal" })).toBe(
      "https://waze.com/ul?q=Rua%20Exemplo%20245%20Centro%20Natal&navigate=yes",
    );
  });

  it("codifica acento e & — senao o link quebra no meio", () => {
    // "Conceição" e "&" cortariam a query se fossem crus.
    const l = linkWaze({ logradouro: "Av. Conceição & Cia", cidade: "São Paulo" });
    expect(l).toContain("Concei%C3%A7%C3%A3o");
    expect(l).toContain("%26");
    expect(l).toContain("S%C3%A3o%20Paulo");
  });

  it("endereco vazio ou nulo nao gera link quebrado", () => {
    // Sem nada, o Waze abre na busca — melhor que um botao que erra.
    expect(linkWaze(null)).toBe("https://waze.com/ul?q=&navigate=yes");
    expect(linkWaze({})).toBe("https://waze.com/ul?q=&navigate=yes");
  });

  it("coordenada ZERO conta como coordenada", () => {
    /*
     * `lat: 0` e falsy. Um teste com `if (lat && lng)` mandaria o endereco por
     * texto no Golfo da Guine — improvavel aqui, mas e o mesmo erro que faz
     * `lng: 0` (meridiano de Greenwich) cair no ramo errado.
     */
    expect(linkWaze({ lat: 0, lng: 0 })).toBe("https://waze.com/ul?ll=0,0&navigate=yes");
  });
});
