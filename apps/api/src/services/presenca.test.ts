import { describe, expect, it } from "vitest";
import { deveFazerCheckin, vereditoPresenca } from "@isphub/shared";

const casa = { lat: -5.79, lng: -35.2 };
const a = (m: number) => ({ lat: -5.79 + m / 111_000, lng: -35.2 }); // ~m metros ao norte

describe("deveFazerCheckin — viatura parou perto da OS a caminho", () => {
  it("parado a 80 m: sim; a 400 m: nao; em movimento a 80 m: nao", () => {
    expect(deveFazerCheckin({ ponto: { ...a(80), velocidadeKmh: 0 }, destino: casa, raioMetros: 150 })).toMatchObject({ sim: true });
    const longe = deveFazerCheckin({ ponto: { ...a(400), velocidadeKmh: 0 }, destino: casa, raioMetros: 150 });
    expect(longe.sim).toBe(false);
    expect(longe.distanciaMetros).toBeGreaterThan(390);
    expect(longe.distanciaMetros).toBeLessThan(410);
    expect(deveFazerCheckin({ ponto: { ...a(80), velocidadeKmh: 35 }, destino: casa, raioMetros: 150 }).sim).toBe(false);
  });
  it("ignicao desligada conta como parado mesmo sem velocidade", () => {
    expect(deveFazerCheckin({ ponto: { ...a(50), velocidadeKmh: null, ignicao: "desligada" }, destino: casa, raioMetros: 150 }).sim).toBe(true);
  });
  it("raio 0 desliga; OS sem coordenada nunca faz check-in", () => {
    expect(deveFazerCheckin({ ponto: { ...a(10), velocidadeKmh: 0 }, destino: casa, raioMetros: 0 }).sim).toBe(false);
    expect(deveFazerCheckin({ ponto: { ...a(10), velocidadeKmh: 0 }, destino: null, raioMetros: 150 }).sim).toBe(false);
  });
});

describe("vereditoPresenca — a viatura passou pelo endereco?", () => {
  it("uma posicao a 50 m basta: presente, com a distancia minima", () => {
    expect(vereditoPresenca({ posicoes: [a(2000), a(50), a(900)], endereco: casa, raioMetros: 300 })).toEqual({ veredito: "presente", distanciaMinMetros: 50 });
  });
  it("nenhuma a menos de 300 m: ausente", () => {
    expect(vereditoPresenca({ posicoes: [a(2000), a(900)], endereco: casa, raioMetros: 300 }).veredito).toBe("ausente");
  });
  it("sem posicoes ou sem endereco: sem_dados, nunca ausente", () => {
    expect(vereditoPresenca({ posicoes: [], endereco: casa, raioMetros: 300 }).veredito).toBe("sem_dados");
    expect(vereditoPresenca({ posicoes: [a(10)], endereco: null, raioMetros: 300 }).veredito).toBe("sem_dados");
  });
});
