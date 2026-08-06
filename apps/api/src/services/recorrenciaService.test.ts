import { describe, expect, it } from "vitest";
import { ocorrenciasEntre, vencimentoNoMes, PASSO_MESES } from "@isphub/shared";

/*
 * O DIA 31 e o motivo deste arquivo existir.
 *
 * O ERP de origem soma "+1 mes" a partir da ocorrencia anterior. A propria
 * documentacao dele registra o efeito: a partir do dia 29-31 a serie encolhe
 * PERMANENTEMENTE ao passar por fevereiro (31/07 -> 31/08 -> 30/09 -> ... ->
 * 28/02 -> 28/03) e o deslize pra tras ainda faz caber uma 13a ocorrencia numa
 * janela de 12 meses. Aqui cada vencimento e recalculado do dia GUARDADO.
 */

describe("vencimentoNoMes — o dia se ajusta ao mes, nao ao contrario", () => {
  it("prende o dia 31 ao ultimo dia do mes curto", () => {
    expect(vencimentoNoMes("2026-01", 31)).toBe("2026-01-31");
    expect(vencimentoNoMes("2026-02", 31)).toBe("2026-02-28");
    expect(vencimentoNoMes("2026-04", 31)).toBe("2026-04-30");
  });

  it("respeita fevereiro bissexto", () => {
    expect(vencimentoNoMes("2028-02", 31)).toBe("2028-02-29");
    expect(vencimentoNoMes("2028-02", 30)).toBe("2028-02-29");
  });

  it("nao mexe em dia que cabe", () => {
    expect(vencimentoNoMes("2026-02", 10)).toBe("2026-02-10");
  });

  it("recusa dia fora da faixa em vez de gerar data invalida", () => {
    expect(vencimentoNoMes("2026-03", 0)).toBe("2026-03-01");
    expect(vencimentoNoMes("2026-03", 99)).toBe("2026-03-31");
  });
});

describe("ocorrenciasEntre — o dia VOLTA depois de fevereiro", () => {
  it("dia 31 mensal: encolhe so em fevereiro e volta em marco", () => {
    const datas = ocorrenciasEntre({
      inicio: "2026-01-31",
      fim: null,
      frequencia: "mensal",
      diaVencimento: 31,
      ate: "2026-05-31",
    });
    // O teste que a origem nao passaria: depois do 28/02 vem 31/03, nao 28/03.
    expect(datas).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("doze meses de mensal dao exatamente DOZE ocorrencias", () => {
    // A 13a ocorrencia da origem nasce do deslize pra tras: cada mes curto
    // adianta a serie e sobra espaco no fim da janela.
    const datas = ocorrenciasEntre({
      inicio: "2026-01-31",
      fim: null,
      frequencia: "mensal",
      diaVencimento: 31,
      ate: "2026-12-31",
    });
    expect(datas).toHaveLength(12);
  });
});

describe("ocorrenciasEntre — passos e limites", () => {
  it("anda com o passo de cada frequencia", () => {
    const dos = (frequencia: keyof typeof PASSO_MESES) =>
      ocorrenciasEntre({ inicio: "2026-01-10", fim: null, frequencia, diaVencimento: 10, ate: "2026-12-31" });

    expect(dos("mensal")).toHaveLength(12);
    expect(dos("bimestral")).toHaveLength(6);
    expect(dos("trimestral")).toHaveLength(4);
    expect(dos("semestral")).toHaveLength(2);
    expect(dos("anual")).toHaveLength(1);
  });

  it("para no fim da vigencia", () => {
    const datas = ocorrenciasEntre({
      inicio: "2026-01-10",
      fim: "2026-03-31",
      frequencia: "mensal",
      diaVencimento: 10,
      ate: "2026-12-31",
    });
    expect(datas).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
  });

  it("nao gera nada alem do horizonte", () => {
    const datas = ocorrenciasEntre({
      inicio: "2026-01-10",
      fim: null,
      frequencia: "mensal",
      diaVencimento: 10,
      ate: "2026-02-28",
    });
    expect(datas).toEqual(["2026-01-10", "2026-02-10"]);
  });

  it("pula a primeira quando o dia ja passou no mes inicial", () => {
    // Comeca em 10/03 com vencimento no dia 5: marco ja passou, entao a
    // primeira ocorrencia e abril — antecipar cobraria por um mes vencido.
    const datas = ocorrenciasEntre({
      inicio: "2026-03-10",
      fim: null,
      frequencia: "mensal",
      diaVencimento: 5,
      ate: "2026-05-31",
    });
    expect(datas).toEqual(["2026-04-05", "2026-05-05"]);
  });

  it("atravessa a virada do ano", () => {
    const datas = ocorrenciasEntre({
      inicio: "2026-11-15",
      fim: null,
      frequencia: "mensal",
      diaVencimento: 15,
      ate: "2027-02-28",
    });
    expect(datas).toEqual(["2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15"]);
  });

  it("horizonte anterior ao inicio nao gera nada", () => {
    expect(
      ocorrenciasEntre({ inicio: "2027-01-10", fim: null, frequencia: "mensal", diaVencimento: 10, ate: "2026-12-31" }),
    ).toEqual([]);
  });

  it("tem teto — recorrencia indefinida com horizonte absurdo nao roda pra sempre", () => {
    const datas = ocorrenciasEntre({
      inicio: "2026-01-10",
      fim: null,
      frequencia: "mensal",
      diaVencimento: 10,
      ate: "2999-12-31",
    });
    expect(datas).toHaveLength(600);
  });
});
