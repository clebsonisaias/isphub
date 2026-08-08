import { describe, expect, it } from "vitest";
import {
  distanciaTotalMetros,
  haversineMetros,
  montarLinhaDoTempo,
  segmentarParadas,
  simplificarTrilha,
  type PontoNoTempo,
} from "@isphub/shared";

/*
 * Contas puras sobre coordenadas. Erram em silencio: uma trilha simplificada
 * demais nao estoura, so desenha um caminho que o carro nao fez — e ninguem
 * confere um mapa contra a realidade.
 */

describe("haversineMetros", () => {
  it("mede uma distancia conhecida em Natal", () => {
    // Ponta Negra -> Centro, ~7,5 km em linha reta.
    const d = haversineMetros({ lat: -5.8817, lng: -35.1786 }, { lat: -5.8195, lng: -35.2117 });
    expect(d).toBeGreaterThan(7_000);
    expect(d).toBeLessThan(8_200);
  });

  it("mesmo ponto da zero", () => {
    expect(haversineMetros({ lat: -5.79, lng: -35.2 }, { lat: -5.79, lng: -35.2 })).toBe(0);
  });

  it("soma os trechos, nao a reta entre as pontas", () => {
    // Ida e volta: a distancia PERCORRIDA e o dobro, mesmo terminando na origem.
    const a = { lat: -5.79, lng: -35.2 };
    const b = { lat: -5.8, lng: -35.2 };
    const ida = haversineMetros(a, b);
    expect(distanciaTotalMetros([a, b, a])).toBeCloseTo(ida * 2, 0);
  });
});

describe("simplificarTrilha", () => {
  it("mantem as duas pontas", () => {
    // Cortar uma ponta moveria o inicio ou o fim do percurso.
    const pontos = Array.from({ length: 50 }, (_, i) => ({ lat: -5.79 + i * 0.0001, lng: -35.2 }));
    const s = simplificarTrilha(pontos, 15);
    expect(s[0]).toEqual(pontos[0]);
    expect(s[s.length - 1]).toEqual(pontos[pontos.length - 1]);
  });

  it("descarta o meio colinear — e o caso do dia inteiro numa avenida", () => {
    const pontos = Array.from({ length: 50 }, (_, i) => ({ lat: -5.79 + i * 0.0001, lng: -35.2 }));
    expect(simplificarTrilha(pontos, 15)).toHaveLength(2);
  });

  it("PRESERVA a curva — simplificar nao pode inventar um caminho que o carro nao fez", () => {
    const pontos = [
      { lat: -5.79, lng: -35.2 },
      { lat: -5.79, lng: -35.19 }, // desvio grande: ~1,1 km fora da reta
      { lat: -5.8, lng: -35.2 },
    ];
    expect(simplificarTrilha(pontos, 15)).toHaveLength(3);
  });

  it("com 2 pontos ou menos, devolve como veio", () => {
    expect(simplificarTrilha([{ lat: 1, lng: 2 }], 15)).toHaveLength(1);
    expect(simplificarTrilha([], 15)).toHaveLength(0);
  });
});

describe("segmentarParadas", () => {
  const base = Date.parse("2026-08-08T11:00:00.000Z");
  const em = (min: number) => new Date(base + min * 60_000).toISOString();

  it("o tremor do GPS parado NAO quebra a parada em varias", () => {
    /*
     * Este e o teste que faz a deteccao servir pra alguma coisa. Um GPS parado
     * nao repete a mesma coordenada — treme dezenas de metros. Comparando ponto
     * a ponto, uma parada de uma hora viraria dezenas de micro-paradas e a linha
     * do tempo ficaria ilegivel.
     */
    const pontos: PontoNoTempo[] = Array.from({ length: 30 }, (_, i) => ({
      lat: -5.79 + (i % 2 === 0 ? 0.0002 : -0.0002), // ~22 m de tremor
      lng: -35.2 + (i % 3 === 0 ? 0.0002 : -0.0001),
      em: em(i * 2),
      velocidadeKmh: 0,
    }));

    const paradas = segmentarParadas(pontos).filter((s) => s.tipo === "parada");
    expect(paradas).toHaveLength(1);
    expect(paradas[0]).toMatchObject({ tipo: "parada" });
    if (paradas[0]?.tipo === "parada") expect(paradas[0].duracaoMin).toBe(58);
  });

  it("semaforo nao e parada", () => {
    // Ficar quieto 2 minutos e transito, e poluiria a linha do tempo.
    const pontos: PontoNoTempo[] = [
      { lat: -5.79, lng: -35.2, em: em(0), velocidadeKmh: 40 },
      { lat: -5.7901, lng: -35.2, em: em(1), velocidadeKmh: 0 },
      { lat: -5.7901, lng: -35.2, em: em(2), velocidadeKmh: 0 },
      { lat: -5.8, lng: -35.21, em: em(10), velocidadeKmh: 45 },
    ];
    expect(segmentarParadas(pontos).filter((s) => s.tipo === "parada")).toHaveLength(0);
  });

  it("andar vira deslocamento com distancia e velocidade maxima", () => {
    const pontos: PontoNoTempo[] = [
      { lat: -5.79, lng: -35.2, em: em(0), velocidadeKmh: 30 },
      { lat: -5.8, lng: -35.2, em: em(5), velocidadeKmh: 62 },
      { lat: -5.81, lng: -35.2, em: em(10), velocidadeKmh: 48 },
    ];
    const desl = segmentarParadas(pontos).filter((s) => s.tipo === "deslocamento");
    expect(desl).toHaveLength(1);
    if (desl[0]?.tipo === "deslocamento") {
      expect(desl[0].velocidadeMaxKmh).toBe(62);
      expect(desl[0].distanciaMetros).toBeGreaterThan(2_000);
    }
  });

  it("menos de dois pontos nao gera segmento nenhum", () => {
    expect(segmentarParadas([])).toEqual([]);
    expect(segmentarParadas([{ lat: 1, lng: 2, em: em(0) }])).toEqual([]);
  });
});

describe("montarLinhaDoTempo", () => {
  const vazio = { jornadas: [], ocupacoes: [], osEventos: [], segmentos: [] };

  it("sem fonte nenhuma, lista vazia", () => {
    expect(montarLinhaDoTempo(vazio)).toEqual([]);
  });

  it("ordena por horario", () => {
    const itens = montarLinhaDoTempo({
      ...vazio,
      jornadas: [
        {
          usuarioNome: "João",
          inicioEm: "2026-08-08T11:00:00.000Z",
          fimEm: "2026-08-08T20:00:00.000Z",
          latInicio: null,
          lngInicio: null,
          latFim: null,
          lngFim: null,
        },
      ],
      osEventos: [
        {
          em: "2026-08-08T12:00:00.000Z",
          osId: "os1",
          sgpOsId: "123",
          eventoTipo: "status",
          descricao: "Em execução",
          autorNome: "João",
          lat: null,
          lng: null,
        },
      ],
    });
    expect(itens.map((i) => i.tipo)).toEqual(["jornada_inicio", "os_evento", "jornada_fim"]);
  });

  it("empate de horario tem ordem FIXA, e ela conta uma historia", () => {
    /*
     * Sem desempate deterministico o mesmo dia aparece diferente a cada
     * refresh. Uma tela que muda sozinha le como bug e destroi a confianca no
     * historico — que e justamente o que esta tela existe pra construir.
     */
    const mesmoInstante = "2026-08-08T11:00:00.000Z";
    const fontes = {
      ...vazio,
      jornadas: [
        { usuarioNome: "João", inicioEm: mesmoInstante, fimEm: null, latInicio: null, lngInicio: null, latFim: null, lngFim: null },
      ],
      ocupacoes: [
        {
          usuarioNome: "João",
          papel: "motorista" as const,
          origem: "jornada" as const,
          declaradoPorNome: "João",
          inicioEm: mesmoInstante,
          fimEm: null,
          latInicio: null,
          lngInicio: null,
          latFim: null,
          lngFim: null,
        },
      ],
      osEventos: [
        {
          em: mesmoInstante,
          osId: "os1",
          sgpOsId: null,
          eventoTipo: "status" as const,
          descricao: "x",
          autorNome: null,
          lat: null,
          lng: null,
        },
      ],
    };
    const esperado = ["jornada_inicio", "ocupacao_inicio", "os_evento"];
    expect(montarLinhaDoTempo(fontes).map((i) => i.tipo)).toEqual(esperado);
    // Duas chamadas, o mesmo resultado.
    expect(montarLinhaDoTempo(fontes).map((i) => i.tipo)).toEqual(esperado);
  });

  it("jornada ABERTA nao inventa um fim", () => {
    // Um horario de fim que ninguem viveu iria pro historico como se fosse fato.
    const itens = montarLinhaDoTempo({
      ...vazio,
      jornadas: [
        { usuarioNome: "João", inicioEm: "2026-08-08T11:00:00.000Z", fimEm: null, latInicio: null, lngInicio: null, latFim: null, lngFim: null },
      ],
    });
    expect(itens.map((i) => i.tipo)).toEqual(["jornada_inicio"]);
  });
});
