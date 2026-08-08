import { describe, expect, it } from "vitest";
import { duracaoJornada, formatarDuracao, jornadaPrecisaAtencao, JORNADA_LONGA_MS } from "@isphub/shared";

/*
 * As funcoes puras da jornada moram em `@isphub/shared` porque o app e o painel
 * web mostram o MESMO numero — dois calculos separados divergiriam e o tecnico
 * e o gestor veriam tempos diferentes pra mesma jornada. O teste vive aqui
 * porque `shared` nao tem vitest configurado, e o import e do pacote publicado.
 */

const INICIO = "2026-08-07T10:00:00.000Z";
const em = (h: number, m = 0) => new Date(Date.parse(INICIO) + h * 3_600_000 + m * 60_000);

describe("duracaoJornada", () => {
  it("decompoe horas e minutos", () => {
    expect(duracaoJornada(INICIO, em(5, 58))).toMatchObject({ horas: 5, minutos: 58 });
  });

  it("nunca devolve negativo", () => {
    /*
     * Acontece de verdade: o `agoraServidor` chega e, entre o fetch e o render,
     * nada garante que o relogio usado seja posterior ao inicio (offset ainda
     * nao aplicado, resposta fora de ordem). "-1h30 trabalhado" seria pior que
     * "0h00".
     */
    expect(duracaoJornada(INICIO, new Date(Date.parse(INICIO) - 60_000)).ms).toBe(0);
  });

  it("trunca, nao arredonda: 59min59s ainda e 0h59", () => {
    // Arredondar mostraria "1h00" antes da hora fechar — o tecnico confere isso.
    expect(duracaoJornada(INICIO, new Date(Date.parse(INICIO) + 59 * 60_000 + 59_000))).toMatchObject({
      horas: 0,
      minutos: 59,
    });
  });
});

describe("formatarDuracao", () => {
  it("usa o formato da referencia", () => {
    expect(formatarDuracao(INICIO, em(5, 58))).toBe("5h58");
  });

  it("zero a esquerda no minuto — sem isso o texto muda de largura sozinho", () => {
    // "5h7" -> "5h08" -> "5h9" faria o mostrador tremer a cada atualizacao.
    expect(formatarDuracao(INICIO, em(5, 7))).toBe("5h07");
    expect(formatarDuracao(INICIO, em(0, 0))).toBe("0h00");
  });

  it("passa de 24h sem quebrar — e o caso do 'esqueci de encerrar'", () => {
    expect(formatarDuracao(INICIO, em(27, 3))).toBe("27h03");
  });
});

describe("jornadaPrecisaAtencao", () => {
  it("11h59 ainda e plausivel", () => {
    expect(jornadaPrecisaAtencao(INICIO, em(11, 59))).toBe(false);
  });

  it("12h01 pede atencao", () => {
    expect(jornadaPrecisaAtencao(INICIO, em(12, 1))).toBe(true);
  });

  it("exatamente no limite ja alerta", () => {
    expect(jornadaPrecisaAtencao(INICIO, new Date(Date.parse(INICIO) + JORNADA_LONGA_MS))).toBe(true);
  });

  it("o classico: aberta desde ontem", () => {
    expect(jornadaPrecisaAtencao(INICIO, em(27))).toBe(true);
  });
});
