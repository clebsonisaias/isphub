import { describe, expect, it } from "vitest";
import { diaBrasileiro, filtroDoDia } from "@isphub/shared";

/*
 * Mora no workspace da API porque `shared` nao tem vitest configurado, e
 * acrescentar a ferramenta so pra este arquivo seria custo sem retorno — o
 * import e de `@isphub/shared`, entao e a funcao publicada que esta sob teste.
 */

/**
 * A fronteira do dia e o unico ponto caro daqui — e vale para as DUAS pontas:
 * a API corta o resumo por ela, o app monta a agenda por ela. Se divergissem,
 * o numero no topo da tela nao bateria com a lista logo abaixo.
 */
describe("diaBrasileiro", () => {
  it("as 23h30 em Natal ainda e o MESMO dia — o caso que um corte em UTC erra", () => {
    // 2026-08-07 23:30 BRT == 2026-08-08 02:30 UTC. Um corte ingenuo leria
    // "dia 8" e jogaria esta OS pra agenda de amanha, com o tecnico ainda nela.
    const { inicio, fim } = diaBrasileiro(new Date("2026-08-08T02:30:00Z"));
    expect(inicio.toISOString()).toBe("2026-08-07T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  });

  it("logo depois da meia-noite BRT ja e o dia seguinte", () => {
    const { inicio } = diaBrasileiro(new Date("2026-08-08T03:10:00Z"));
    expect(inicio.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  });

  it("a janela tem exatamente 24h", () => {
    const { inicio, fim } = diaBrasileiro(new Date("2026-08-07T12:00:00Z"));
    expect(fim.getTime() - inicio.getTime()).toBe(24 * 60 * 60_000);
  });

  it("vira o ano corretamente — 21h de 31/12 ainda e dezembro", () => {
    const { inicio } = diaBrasileiro(new Date("2027-01-01T00:30:00Z"));
    expect(inicio.toISOString()).toBe("2026-12-31T03:00:00.000Z");
  });
});

describe("filtroDoDia", () => {
  it("`ate` e o ULTIMO instante do dia, nao a meia-noite seguinte", () => {
    /*
     * `fila.ts` filtra com `lte` (inclusivo). Mandar o fim exclusivo puxaria a
     * primeira OS de amanha — uma OS agendada exatamente 00:00 — pra agenda de
     * hoje. Um item fantasma no fim da lista e dificil de notar e pior de
     * explicar.
     */
    const { de, ate } = filtroDoDia(new Date("2026-08-07T12:00:00Z"));
    expect(de).toBe("2026-08-07T03:00:00.000Z");
    expect(ate).toBe("2026-08-08T02:59:59.999Z");
  });
});
