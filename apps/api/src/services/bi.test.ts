import { describe, expect, it } from "vitest";
import {
  CONSUMO_MARCHA_LENTA_L_HORA,
  chaveDiaBrasileiro,
  custoPorKm,
  COBERTURA_MINIMA_PCT,
  avaliarDivergencia,
  coberturaPct,
  diasDoIntervalo,
  formatarCustoPorKm,
  horaBrasileira,
  litrosOciosos,
  mediana,
  precoMedioLitro,
  razaoOdometroGps,
} from "@isphub/shared";

/**
 * As regras do BI da frota.
 *
 * Todo teste aqui existe porque a conta correspondente erraria SEM levantar
 * excecao: um painel de custo que fecha e mente é pior que um que quebra.
 */

describe("o dia brasileiro", () => {
  it("22h em Natal ainda é HOJE, não amanhã", () => {
    /*
     * O servidor roda sem `TZ`, ou seja, em UTC. Agrupar por dia UTC jogaria
     * tudo entre 21h e a meia-noite pro dia seguinte — e num BI isso nao
     * aparece como erro, aparece como um pico de quilometragem na madrugada.
     */
    // 2026-08-08 22:30 em Natal = 2026-08-09 01:30 UTC.
    expect(chaveDiaBrasileiro(new Date("2026-08-09T01:30:00.000Z"))).toBe("2026-08-08");
  });

  it("a meia-noite brasileira vira o dia", () => {
    expect(chaveDiaBrasileiro(new Date("2026-08-09T02:59:59.000Z"))).toBe("2026-08-08");
    expect(chaveDiaBrasileiro(new Date("2026-08-09T03:00:00.000Z"))).toBe("2026-08-09");
  });

  it("a hora do pico é a hora de quem dirige, não a do servidor", () => {
    // 07:00 em Natal = 10:00 UTC. Em UTC o pico da manha apareceria as 10h.
    expect(horaBrasileira(new Date("2026-08-08T10:00:00.000Z"))).toBe(7);
  });

  it("o intervalo inclui os dias VAZIOS", () => {
    /*
     * Uma serie montada so com os dias que tiveram viagem esconde justamente o
     * que interessa: o dia em que o carro nao saiu vira um buraco no eixo, e o
     * olho le "nao medimos" onde a verdade e "nao rodou".
     */
    const dias = diasDoIntervalo(new Date("2026-08-06T12:00:00Z"), new Date("2026-08-09T12:00:00Z"));
    expect(dias).toEqual(["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]);
  });

  it("intervalo absurdo do usuario nao vira laco infinito", () => {
    const dias = diasDoIntervalo(new Date("2020-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
    expect(dias).toHaveLength(400);
  });
});

describe("razão odômetro ÷ GPS", () => {
  it("mede sem julgar", () => {
    // 100 km no odometro, 90 km no GPS: razao 1,11. NAO e suspeito por si.
    expect(razaoOdometroGps(100, 90_000)).toBeCloseTo(1.111, 3);
  });

  it("qualquer lado ausente ou zerado devolve null, nunca Infinity", () => {
    /*
     * Dividir por zero daria Infinity, e Infinity num painel vira "999.999" sem
     * que ninguem entenda de onde veio.
     */
    expect(razaoOdometroGps(null, 90_000)).toBeNull();
    expect(razaoOdometroGps(100, null)).toBeNull();
    expect(razaoOdometroGps(100, 0)).toBeNull();
    expect(razaoOdometroGps(0, 90_000)).toBeNull();
    expect(razaoOdometroGps(-50, 90_000)).toBeNull();
  });
});

describe("cobertura — a métrica PRIMÁRIA da auditoria", () => {
  it("mede quanto do período o aparelho enxergou", () => {
    expect(coberturaPct(0, 1440)).toBe(100);
    expect(coberturaPct(720, 1440)).toBe(50);
  });

  it("período de duração zero não tem cobertura", () => {
    expect(coberturaPct(0, 0)).toBeNull();
  });

  it("tempo cego maior que o período é grampeado, não vira negativo", () => {
    // Evento `ficou_offline` orfao pode render um cego maior que a janela.
    expect(coberturaPct(5000, 1440)).toBe(0);
  });
});

describe("mediana", () => {
  it("abaixo do mínimo de amostras devolve null", () => {
    expect(mediana([1.1, 1.2], 3)).toBeNull();
  });

  it("é MEDIANA e não média: um odômetro digitado errado não arrasta a base", () => {
    /*
     * Um zero a mais num odometro (razao 50) arrastaria a media para ~9,2 e
     * faria todo o resto parecer normal — o oposto do que o painel precisa.
     */
    expect(mediana([1.1, 1.15, 1.2, 1.25, 1.3, 50], 3)).toBeCloseTo(1.225, 3);
  });

  it("ignora os nulos ao contar amostras", () => {
    expect(mediana([1.1, null, 1.2], 3)).toBeNull();
  });
});

describe("veredito da divergência", () => {
  const historicoBom = [1.1, 1.12, 1.08, 1.11];

  it("cobertura baixa CALA o veredito — o buraco explica qualquer coisa", () => {
    /*
     * A inversao central deste modulo: a razao odometro/GPS parece medir o
     * motorista, mas o termo dominante e quanto o aparelho enxergou. Com o
     * rastreador cego metade do periodo, qualquer divergencia e do hardware.
     */
    const v = avaliarDivergencia({ razao: 1.9, cobertura: 60, historico: historicoBom });
    expect(v).toEqual({ tipo: "sem_base", motivo: "cobertura_baixa" });
  });

  it("sem histórico próprio não há base — mesmo com cobertura perfeita", () => {
    const v = avaliarDivergencia({ razao: 1.9, cobertura: 100, historico: [1.1] });
    expect(v).toEqual({ tipo: "sem_base", motivo: "sem_historico" });
  });

  it("o carro que se comporta como ele mesmo fica DENTRO, mesmo divergindo 10%", () => {
    /*
     * E o ponto do desenho: 1,10 nao e suspeito se este carro sempre fez 1,10.
     * Calibrar pela mediana da FROTA transformaria "roda no centro" em "fora do
     * padrao".
     */
    const v = avaliarDivergencia({ razao: 1.1, cobertura: 100, historico: historicoBom });
    expect(v.tipo).toBe("dentro");
  });

  it("o carro que MUDOU em relação a si mesmo entra em revisar", () => {
    const v = avaliarDivergencia({ razao: 1.5, cobertura: 100, historico: historicoBom });
    expect(v.tipo).toBe("revisar");
    if (v.tipo === "revisar") {
      expect(v.desvioPct).toBeGreaterThan(25);
      // Os dois numeros crus acompanham, para o leitor poder discordar.
      expect(v.razao).toBe(1.5);
      expect(v.base).toBeCloseTo(1.105, 3);
    }
  });

  it("rastreador cego sem NENHUMA viagem culpa a cobertura, não a falta de medida", () => {
    /*
     * O caso que o seed revelou: com o aparelho mudo, o GPS soma zero e a razao
     * vem `null`. As duas explicacoes cabem — mas so uma diz o que fazer.
     * "Sem medida" manda procurar odometro; "ficou cego" manda olhar o aparelho.
     */
    const v = avaliarDivergencia({ razao: null, cobertura: 51, historico: historicoBom });
    expect(v).toEqual({ tipo: "sem_base", motivo: "cobertura_baixa" });
  });

  it("sem medida nenhuma, sem_base — nunca 1,0 implícito", () => {
    expect(avaliarDivergencia({ razao: null, cobertura: 100, historico: historicoBom })).toEqual({
      tipo: "sem_base",
      motivo: "sem_medida",
    });
  });

  it("o piso de cobertura é o limite, não uma sugestão", () => {
    const abaixo = avaliarDivergencia({ razao: 1.5, cobertura: COBERTURA_MINIMA_PCT - 1, historico: historicoBom });
    const noLimite = avaliarDivergencia({ razao: 1.5, cobertura: COBERTURA_MINIMA_PCT, historico: historicoBom });
    expect(abaixo.tipo).toBe("sem_base");
    expect(noLimite.tipo).toBe("revisar");
  });
});

describe("litros ociosos", () => {
  it("uma hora de motor ligado parado queima a taxa de referência", () => {
    expect(litrosOciosos(3600)).toBeCloseTo(CONSUMO_MARCHA_LENTA_L_HORA, 5);
  });

  it("sem tempo medido não há estimativa", () => {
    expect(litrosOciosos(null)).toBeNull();
    expect(litrosOciosos(0)).toBeNull();
  });
});

describe("custo por km", () => {
  it("R$ 182,00 em 100 km dá R$ 1,82/km", () => {
    expect(custoPorKm(18_200, 100)).toBe("1.82");
    expect(formatarCustoPorKm(custoPorKm(18_200, 100))).toBe("R$ 1,82/km");
  });

  it("sem quilometragem não há custo por km", () => {
    // Um custo por km sem km e uma divisao por zero disfarcada de metrica.
    expect(custoPorKm(18_200, 0)).toBeNull();
    expect(custoPorKm(18_200, null)).toBeNull();
    expect(formatarCustoPorKm(null)).toBe("—");
  });
});

describe("preço médio do litro", () => {
  it("é a soma dos valores dividida pela soma dos litros, não a média dos preços", () => {
    /*
     * 5 L a R$ 8,00 (R$ 40) + 50 L a R$ 5,00 (R$ 250) = R$ 290 / 55 L = R$ 5,27.
     * A media simples dos precos unitarios daria R$ 6,50 — e mentiria sobre
     * quanto a frota efetivamente pagou, porque daria ao posto caro o mesmo
     * peso do barato.
     */
    expect(precoMedioLitro(29_000, 55)).toBe("5.27");
  });

  it("sem litros não há preço", () => {
    expect(precoMedioLitro(29_000, 0)).toBeNull();
    expect(precoMedioLitro(null, 55)).toBeNull();
  });
});
