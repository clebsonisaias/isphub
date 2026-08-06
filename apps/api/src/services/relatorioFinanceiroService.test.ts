import { describe, expect, it } from "vitest";
import {
  diasEntre,
  formatarMesCurto,
  mesAtual,
  mesesEntre,
  primeiroDiaDoMes,
  somarMeses,
  ultimoDiaDoMes,
} from "@isphub/shared";
import { montarLinhasDre, ultimosMeses, type TotaisDre } from "./relatorioFinanceiroService.js";

/** Atalho: pega o valor de uma linha do DRE pela chave. */
function valorDe(linhas: ReturnType<typeof montarLinhasDre>, chave: string): string | undefined {
  return linhas.find((l) => l.chave === chave)?.valor;
}

const ZERADO: TotaisDre = {
  receitaBruta: "0.00",
  deducoes: "0.00",
  custosVariaveis: "0.00",
  despesasOperacionais: "0.00",
  semClassificacao: "0.00",
};

describe("DRE — a cadeia de subtracoes", () => {
  it("encadeia receita liquida, lucro bruto e resultado", () => {
    const linhas = montarLinhasDre({
      receitaBruta: "10000.00",
      deducoes: "600.00", // 6% Simples
      custosVariaveis: "1500.00",
      despesasOperacionais: "4000.00",
      semClassificacao: "0.00",
    });

    expect(valorDe(linhas, "receita_liquida")).toBe("9400.00"); // 10000 - 600
    expect(valorDe(linhas, "lucro_bruto")).toBe("7900.00"); // 9400 - 1500
    expect(valorDe(linhas, "resultado")).toBe("3900.00"); // 7900 - 4000
  });

  it("fecha exatamente com centavos que quebram em float", () => {
    // 0,10 + 0,20 em ponto flutuante da 0.30000000000000004 — o tipo de
    // centavo que faz um demonstrativo nao bater no fim do ano.
    const linhas = montarLinhasDre({
      receitaBruta: "0.30",
      deducoes: "0.10",
      custosVariaveis: "0.20",
      despesasOperacionais: "0.00",
      semClassificacao: "0.00",
    });
    expect(valorDe(linhas, "receita_liquida")).toBe("0.20");
    expect(valorDe(linhas, "lucro_bruto")).toBe("0.00");
    expect(valorDe(linhas, "resultado")).toBe("0.00");
  });

  it("aceita resultado NEGATIVO em vez de zerar o prejuizo", () => {
    const linhas = montarLinhasDre({
      receitaBruta: "1000.00",
      deducoes: "0.00",
      custosVariaveis: "0.00",
      despesasOperacionais: "1500.00",
      semClassificacao: "0.00",
    });
    expect(valorDe(linhas, "resultado")).toBe("-500.00");
  });

  it("nao quebra com tudo zerado", () => {
    const linhas = montarLinhasDre(ZERADO);
    expect(valorDe(linhas, "resultado")).toBe("0.00");
    // Sem receita, "percentual da receita" nao significa nada — e null, nao 0%.
    expect(linhas.every((l) => l.percentualDaReceita === null)).toBe(true);
  });
});

describe("DRE — o nao-classificado nao se esconde", () => {
  it("a linha so aparece quando ha valor sem classificacao", () => {
    expect(montarLinhasDre(ZERADO).some((l) => l.chave === "sem_classificacao")).toBe(false);

    const comOrfao = montarLinhasDre({ ...ZERADO, receitaBruta: "100.00", semClassificacao: "10.00" });
    expect(comOrfao.some((l) => l.chave === "sem_classificacao")).toBe(true);
  });

  it("o nao-classificado E DESCONTADO do resultado", () => {
    /*
     * O ponto que separa este DRE do de origem. La a despesa sem classificacao
     * e dobrada em "custos variaveis" sem aviso; aqui ela fica visivel E entra
     * na conta. Se alguem "limpar" a linha do relatorio um dia, este teste cai
     * — porque o resultado voltaria a ser 100 em vez de 70.
     */
    const linhas = montarLinhasDre({
      receitaBruta: "100.00",
      deducoes: "0.00",
      custosVariaveis: "0.00",
      despesasOperacionais: "0.00",
      semClassificacao: "30.00",
    });
    expect(valorDe(linhas, "lucro_bruto")).toBe("100.00");
    expect(valorDe(linhas, "resultado")).toBe("70.00");
  });

  it("a linha vem marcada como alerta", () => {
    const linhas = montarLinhasDre({ ...ZERADO, receitaBruta: "100.00", semClassificacao: "1.00" });
    expect(linhas.find((l) => l.chave === "sem_classificacao")?.alerta).toBe(true);
    // E so ela — alerta em tudo nao alerta nada.
    expect(linhas.filter((l) => l.alerta).length).toBe(1);
  });
});

describe("DRE — percentual da receita", () => {
  it("calcula sobre a receita bruta, com uma casa", () => {
    const linhas = montarLinhasDre({ ...ZERADO, receitaBruta: "1000.00", deducoes: "60.00" });
    expect(linhas.find((l) => l.chave === "deducoes")?.percentualDaReceita).toBe("6.0");
    expect(linhas.find((l) => l.chave === "receita_bruta")?.percentualDaReceita).toBe("100.0");
  });

  it("arredonda sem passar por float", () => {
    // 333,33 de 1000 = 33,333% -> "33.3"
    const linhas = montarLinhasDre({ ...ZERADO, receitaBruta: "1000.00", custosVariaveis: "333.33" });
    expect(linhas.find((l) => l.chave === "custos_variaveis")?.percentualDaReceita).toBe("33.3");
  });

  it("e null quando nao ha receita, em vez de dividir por zero", () => {
    const linhas = montarLinhasDre({ ...ZERADO, despesasOperacionais: "500.00" });
    expect(linhas.find((l) => l.chave === "despesas_operacionais")?.percentualDaReceita).toBeNull();
  });
});

describe("meses — aritmetica de calendario sem Date", () => {
  it("soma mes atravessando a virada do ano", () => {
    expect(somarMeses("2026-12", 1)).toBe("2027-01");
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("2026-08", 12)).toBe("2027-08");
    expect(somarMeses("2026-08", -12)).toBe("2025-08");
  });

  it("soma mes sem depender de dia nenhum", () => {
    // `new Date(2026, 0, 31)` mais um mes da 03/03 — o Date "corrige" 31 de
    // fevereiro sozinho. Somar mes em campo de MES nao deveria ter esse risco.
    expect(somarMeses("2026-01", 1)).toBe("2026-02");
    expect(somarMeses("2026-01", 13)).toBe("2027-02");
  });

  it("lista meses inclusive nas duas pontas", () => {
    expect(mesesEntre("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(mesesEntre("2026-05", "2026-05")).toEqual(["2026-05"]);
    expect(mesesEntre("2026-05", "2026-04")).toEqual([]); // invertido = vazio
  });

  it("tem teto: recorte absurdo nao vira laco infinito", () => {
    expect(mesesEntre("1900-01", "2100-01").length).toBe(120);
  });

  it("sabe o ultimo dia do mes, inclusive em fevereiro bissexto", () => {
    expect(ultimoDiaDoMes("2026-02")).toBe("2026-02-28");
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29");
    expect(ultimoDiaDoMes("2026-04")).toBe("2026-04-30");
    expect(ultimoDiaDoMes("2026-12")).toBe("2026-12-31");
    expect(primeiroDiaDoMes("2026-12")).toBe("2026-12-01");
  });

  it("formata o rotulo curto do eixo", () => {
    expect(formatarMesCurto("2026-08")).toBe("ago/26");
    expect(formatarMesCurto("2025-01")).toBe("jan/25");
  });

  it("mesAtual devolve o mes de hoje", () => {
    expect(mesAtual(new Date("2026-08-05T12:00:00Z"))).toBe("2026-08");
  });
});

describe("ultimosMeses", () => {
  it("devolve uma janela que TERMINA no mes corrente", () => {
    expect(ultimosMeses(12, "2026-08-05")).toEqual({ de: "2025-09", ate: "2026-08" });
    expect(ultimosMeses(1, "2026-08-05")).toEqual({ de: "2026-08", ate: "2026-08" });
  });

  it("a janela tem exatamente N meses", () => {
    const { de, ate } = ultimosMeses(12, "2026-08-05");
    expect(mesesEntre(de, ate)).toHaveLength(12);
  });
});

describe("diasEntre — usado no atraso da inadimplencia", () => {
  it("conta dias corridos entre duas datas civis", () => {
    expect(diasEntre("2026-08-01", "2026-08-05")).toBe(4);
    expect(diasEntre("2026-08-05", "2026-08-05")).toBe(0);
  });

  it("atravessa mes e ano", () => {
    expect(diasEntre("2026-01-31", "2026-02-01")).toBe(1);
    expect(diasEntre("2025-12-31", "2026-01-01")).toBe(1);
    // 2028 e bissexto: fevereiro tem 29.
    expect(diasEntre("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("e negativo quando a ordem inverte", () => {
    expect(diasEntre("2026-08-05", "2026-08-01")).toBe(-4);
  });
});

describe("percentual — o sinal nao pode sumir", () => {
  it("mantem o sinal num prejuizo menor que 1% da receita", () => {
    /*
     * `Math.trunc(-0.5)` e `-0`, e `${-0}` imprime "0". Montado ingenuamente, um
     * resultado de -0,5% sairia como "0.5" — positivo. O sinal desaparecia
     * exatamente na faixa em que ele inverte o significado da linha.
     */
    const linhas = montarLinhasDre({
      receitaBruta: "10000.00",
      deducoes: "0.00",
      custosVariaveis: "0.00",
      despesasOperacionais: "10050.00",
      semClassificacao: "0.00",
    });
    const resultado = linhas.find((l) => l.chave === "resultado")!;
    expect(resultado.valor).toBe("-50.00");
    expect(resultado.percentualDaReceita).toBe("-0.5");
  });

  it("mantem o sinal num prejuizo grande", () => {
    const linhas = montarLinhasDre({
      receitaBruta: "1000.00",
      deducoes: "0.00",
      custosVariaveis: "0.00",
      despesasOperacionais: "2500.00",
      semClassificacao: "0.00",
    });
    expect(linhas.find((l) => l.chave === "resultado")?.percentualDaReceita).toBe("-150.0");
  });
});
