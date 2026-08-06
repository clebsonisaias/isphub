import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  competenciaDe,
  deCentavos,
  estaAtrasado,
  formatarCompetencia,
  formatarDataIso,
  formatarMoeda,
  normalizarValor,
  paraCentavos,
  situacaoDe,
} from "@isphub/shared";
import { HttpError } from "../middleware/errorHandler.js";
import {
  dataCivil,
  exigirTransicao,
  exigirValor,
  isoDeData,
  moeda,
  montarWhere,
  origemDe,
  podeTransicionar,
  somarValores,
  toPublic,
} from "./lancamentoService.js";

/*
 * As duas invariantes do modulo financeiro sao testadas aqui de forma direta,
 * porque as duas ja custaram caro no ERP de origem:
 *
 *   1. dinheiro nunca vira float
 *   2. data civil nunca desliza um dia por causa de fuso
 *
 * Nao e teste de "cobertura": cada caso abaixo corresponde a um defeito real
 * documentado em `docs/arquitetura/04-dividas-tecnicas-e-riscos.md` da origem.
 */

describe("dinheiro — nunca float", () => {
  it("soma 0,10 + 0,20 dando exatamente 0,30", () => {
    // Em float, Number("0.1") + Number("0.2") = 0.30000000000000004.
    expect(somarValores(["0.10", "0.20"])).toBe("0.30");
  });

  it("soma centavos repetidos sem acumular erro", () => {
    // 0,07 dez vezes: em float da 0.6999999999999998.
    expect(somarValores(Array(10).fill("0.07"))).toBe("0.70");
  });

  it("soma valores grandes sem perder precisao", () => {
    expect(somarValores(["999999999999.99", "0.01"])).toBe("1000000000000.00");
  });

  it("converte pra centavos e de volta sem deriva", () => {
    for (const v of ["0.01", "0.10", "1.05", "1234.56", "999999999999.99"]) {
      expect(deCentavos(paraCentavos(v))).toBe(v);
    }
  });

  it("normaliza os formatos que uma pessoa realmente digita", () => {
    expect(normalizarValor("1234.56")).toBe("1234.56");
    expect(normalizarValor("1234,56")).toBe("1234.56");
    expect(normalizarValor("1.234,56")).toBe("1234.56"); // pt-BR com milhar
    expect(normalizarValor("100")).toBe("100.00");
    expect(normalizarValor("  99,5 ")).toBe("99.50");
  });

  it("recusa o que nao e dinheiro", () => {
    expect(normalizarValor("")).toBeNull();
    expect(normalizarValor("abc")).toBeNull();
    expect(normalizarValor("-10")).toBeNull();
    expect(normalizarValor("1.234.56")).toBeNull(); // ambiguo: dois pontos sem virgula
    expect(normalizarValor("10,999")).toBeNull(); // 3 casas nao e centavo
  });

  it("recusa lancamento de zero", () => {
    // Zero nao e lancamento: e ruido na lista e no total.
    expect(normalizarValor("0")).toBeNull();
    expect(normalizarValor("0,00")).toBeNull();
  });

  it("exigirValor devolve a forma canonica e recusa o resto com 400", () => {
    expect(exigirValor("1.234,5")).toBe("1234.50");
    expect(() => exigirValor("zero")).toThrow(HttpError);
    try {
      exigirValor("zero");
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }
  });

  it("formata pra exibicao sem passar por number", () => {
    expect(formatarMoeda("1234.56")).toBe("R$ 1.234,56");
    expect(formatarMoeda("1000000.00")).toBe("R$ 1.000.000,00");
    expect(formatarMoeda("0.07")).toBe("R$ 0,07");
    expect(formatarMoeda("-50.00")).toBe("-R$ 50,00");
  });
});

describe("data civil — nunca desliza um dia", () => {
  it("grava o dia exatamente como veio escrito, ancorando ao meio-dia UTC", () => {
    // O bug da origem: new Date("2026-02-23") e meia-noite UTC = dia 22 em BRT.
    // Meio-dia UTC tem 12h de folga pra cada lado — nenhum fuso muda o dia.
    expect(dataCivil("2026-02-23").toISOString()).toBe("2026-02-23T12:00:00.000Z");
    expect(isoDeData(dataCivil("2026-02-23"))).toBe("2026-02-23");
  });

  it("sobrevive a virada de ano e a fevereiro bissexto", () => {
    expect(isoDeData(dataCivil("2025-12-31"))).toBe("2025-12-31");
    expect(isoDeData(dataCivil("2026-01-01"))).toBe("2026-01-01");
    expect(isoDeData(dataCivil("2028-02-29"))).toBe("2028-02-29"); // 2028 e bissexto
  });

  it("recusa data que nao existe em vez de deixar o Date corrigir sozinho", () => {
    // new Date("2026-02-31") vira 03/03 em silencio — um vencimento que anda
    // sozinho e pior do que um vencimento recusado.
    expect(() => dataCivil("2026-02-31")).toThrow(HttpError);
    expect(() => dataCivil("2026-13-01")).toThrow(HttpError);
    expect(() => dataCivil("31/12/2026")).toThrow(HttpError);
    expect(() => dataCivil("")).toThrow(HttpError);
  });

  it("formata pra exibicao fatiando a string, sem construir Date", () => {
    expect(formatarDataIso("2026-02-23")).toBe("23/02/2026");
    expect(formatarCompetencia("2026-08-01")).toBe("ago/2026");
  });

  it("deduz a competencia como o primeiro dia do mes do vencimento", () => {
    // A mensalidade de marco que vence 10/abril pertence a MARCO — mas quando
    // nada e informado, o mes do proprio vencimento e o palpite honesto.
    expect(competenciaDe("2026-04-10")).toBe("2026-04-01");
    expect(competenciaDe("2026-12-31")).toBe("2026-12-01");
  });
});

describe("atrasado — derivado, nunca gravado", () => {
  const hoje = "2026-08-05";

  it("vencido e pendente = atrasado", () => {
    expect(estaAtrasado("pendente", "2026-08-04", hoje)).toBe(true);
    expect(situacaoDe("pendente", "2026-08-04", hoje)).toBe("atrasado");
  });

  it("vencer HOJE nao e atraso — o dia ainda nao acabou", () => {
    expect(estaAtrasado("pendente", hoje, hoje)).toBe(false);
    expect(situacaoDe("pendente", hoje, hoje)).toBe("pendente");
  });

  it("pago ou cancelado nunca e atrasado, por mais velho que seja", () => {
    expect(estaAtrasado("pago", "2020-01-01", hoje)).toBe(false);
    expect(estaAtrasado("cancelado", "2020-01-01", hoje)).toBe(false);
    expect(situacaoDe("pago", "2020-01-01", hoje)).toBe("pago");
  });

  it("compara data como string, e a ordem lexicografica bate com a cronologica", () => {
    // E por isso que a comparacao pode ser feita sem converter pra Date —
    // converter so pra comparar reabriria a porta do bug de fuso.
    expect("2026-01-02" < "2026-01-10").toBe(true);
    expect("2025-12-31" < "2026-01-01").toBe(true);
  });
});

describe("transicoes de status", () => {
  it("permite o caminho normal e o estorno", () => {
    expect(podeTransicionar("pendente", "pago")).toBe(true);
    expect(podeTransicionar("pendente", "cancelado")).toBe(true);
    expect(podeTransicionar("pago", "pendente")).toBe(true); // estorno
  });

  it("cancelado e terminal", () => {
    expect(podeTransicionar("cancelado", "pendente")).toBe(false);
    expect(podeTransicionar("cancelado", "pago")).toBe(false);
  });

  it("nao da pra dar baixa duas vezes", () => {
    expect(podeTransicionar("pago", "pago")).toBe(false);
    expect(podeTransicionar("pago", "cancelado")).toBe(false);
  });

  it("exigirTransicao recusa com 409, nao com 400", () => {
    // 409 (conflito de estado), nao 400 (dado invalido): o pedido esta bem
    // formado, o lancamento e que ja mudou.
    try {
      exigirTransicao("pago", "pago", "dar baixa");
      expect.unreachable("deveria ter lancado");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(409);
    }
  });
});

describe("montarWhere", () => {
  const hoje = "2026-08-05";

  it("traduz a situacao derivada 'atrasado' em status + vencimento", () => {
    // "atrasado" nao e coluna: vira exatamente o par que o indice
    // [status, vencimento] cobre.
    const w = montarWhere({ situacao: "atrasado" }, hoje);
    expect(w.status).toBe("pendente");
    expect(w.vencimento).toEqual({ lt: dataCivil(hoje) });
  });

  it("passa as situacoes reais direto pro status", () => {
    expect(montarWhere({ situacao: "pago" }, hoje).status).toBe("pago");
    expect(montarWhere({ situacao: "cancelado" }, hoje).status).toBe("cancelado");
  });

  it("recorta por faixa de vencimento", () => {
    const w = montarWhere({ de: "2026-08-01", ate: "2026-08-31" }, hoje);
    expect(w.vencimento).toEqual({ gte: dataCivil("2026-08-01"), lte: dataCivil("2026-08-31") });
  });

  it("busca por numero acha o lancamento pelo identificador humano", () => {
    // "231" tem que achar o lancamento 231 — e assim que as pessoas falam dele.
    const w = montarWhere({ busca: "231" }, hoje);
    expect(w.OR).toContainEqual({ numero: 231 });
  });

  it("busca por texto nao vira busca por numero", () => {
    const w = montarWhere({ busca: "aluguel" }, hoje);
    // descricao + observacao + numeroDocumento — e NENHUM ramo por `numero`,
    // que so entra quando o termo e um inteiro positivo.
    expect(w.OR).toHaveLength(3);
    expect(w.OR).not.toContainEqual(expect.objectContaining({ numero: expect.anything() }));
  });

  it("nao inventa filtro quando nada foi pedido", () => {
    // Um `where` com chaves indefinidas escondidas mudaria silenciosamente o
    // total — que e o numero em que as pessoas confiam.
    expect(montarWhere({}, hoje)).toEqual({});
  });
});

/*
 * A REGRA DO DINHEIRO, verificada na saida real da API.
 *
 * JSON nao tem decimal: se um campo monetario sair como `number`, ele ja virou
 * double IEEE-754 antes de chegar na tela, e nenhuma formatacao no cliente
 * desfaz isso. Este bloco varre o objeto que a rota devolve e falha se
 * qualquer campo de dinheiro nao for string — inclusive depois de um
 * round-trip por JSON.stringify, que e o que de fato acontece na resposta.
 */
describe("regra do dinheiro — nenhum campo monetario sai como number", () => {
  const CAMPOS_MONETARIOS = ["valor", "valorPago"] as const;

  const linha = {
    id: "11111111-1111-1111-1111-111111111111",
    numero: 231,
    tipo: "receita" as const,
    status: "pago" as const,
    descricao: "Mensalidade do provedor",
    valor: new Prisma.Decimal("1234.56"),
    vencimento: dataCivil("2026-08-10"),
    competencia: dataCivil("2026-08-01"),
    pagoEm: dataCivil("2026-08-09"),
    valorPago: new Prisma.Decimal("1200.00"),
    formaPagamento: "pix" as const,
    provedorId: null,
    categoriaId: null,
    observacao: null,
    numeroDocumento: null,
    ehServico: false,
    recorrenciaId: null,
    parcelamentoId: null,
    recorrencia: null,
    comprovanteMime: null,
    comprovanteNome: null,
    criadoEm: new Date("2026-08-01T09:00:00.000Z"),
    provedor: null,
    categoria: null,
    criadoPor: { nome: "Admin" },
  };

  it("serializa Decimal como string com duas casas", () => {
    expect(moeda(new Prisma.Decimal("1234.5"))).toBe("1234.50");
    expect(moeda(new Prisma.Decimal("0.1"))).toBe("0.10");
    expect(moeda(null)).toBeNull();
  });

  it("toPublic devolve dinheiro como string", () => {
    const dto = toPublic(linha, "2026-08-15");
    for (const campo of CAMPOS_MONETARIOS) {
      expect(typeof dto[campo], `${campo} deveria ser string`).toBe("string");
    }
    expect(dto.valor).toBe("1234.56");
    expect(dto.valorPago).toBe("1200.00");
  });

  it("sobrevive ao round-trip por JSON sem virar number", () => {
    // Este e o teste que importa: e exatamente o caminho da resposta HTTP.
    const roundtrip = JSON.parse(JSON.stringify(toPublic(linha, "2026-08-15")));
    for (const campo of CAMPOS_MONETARIOS) {
      expect(typeof roundtrip[campo], `${campo} virou ${typeof roundtrip[campo]} no JSON`).toBe("string");
    }
  });

  it("datas civis saem como AAAA-MM-DD, sem hora nem fuso", () => {
    const dto = toPublic(linha, "2026-08-15");
    for (const campo of ["vencimento", "competencia", "pagoEm"] as const) {
      expect(dto[campo], `${campo} deveria ser data civil`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(dto.vencimento).toBe("2026-08-10");
  });

  it("temComprovante nao carrega os bytes do comprovante", () => {
    // O SELECT da listagem nao traz `comprovanteDados` de proposito: o PDF de
    // cada lancamento numa lista de 200 e o tipo de select que so aparece em
    // producao. O mime basta pra responder "tem comprovante?".
    expect(toPublic(linha).temComprovante).toBe(false);
    expect(toPublic({ ...linha, comprovanteMime: "application/pdf" }).temComprovante).toBe(true);
    expect(Object.keys(toPublic(linha))).not.toContain("comprovanteDados");
  });

  it("a situacao derivada aparece no DTO sem virar coluna", () => {
    const vencido = { ...linha, status: "pendente" as const, pagoEm: null, valorPago: null };
    expect(toPublic(vencido, "2026-08-15").situacao).toBe("atrasado");
    expect(toPublic(vencido, "2026-08-15").status).toBe("pendente");
  });
});

/*
 * ORIGEM DERIVADA, nao gravada.
 *
 * Uma coluna "origem" ao lado das FKs seria uma segunda verdade sobre o mesmo
 * fato — e a denormalizada e sempre a que diverge, porque nada obriga as duas a
 * andarem juntas.
 */
describe("origemDe", () => {
  const base = { recorrenciaId: null, parcelamentoId: null, recorrencia: null };

  it("sem vinculo nenhum e avulso — o 'pontual' da origem", () => {
    expect(origemDe(base)).toBe("avulso");
  });

  it("com parcelamento e parcelado", () => {
    expect(origemDe({ ...base, parcelamentoId: "p1" })).toBe("parcelado");
  });

  it("com recorrencia SEM tipo de provisao e recorrente", () => {
    expect(origemDe({ ...base, recorrenciaId: "r1", recorrencia: { tipoProvisao: null } })).toBe("recorrente");
  });

  it("com recorrencia COM tipo de provisao e provisao", () => {
    expect(origemDe({ ...base, recorrenciaId: "r1", recorrencia: { tipoProvisao: "folha" } })).toBe("provisao");
  });

  it("parcelamento ganha da recorrencia — uma linha nao e as duas coisas", () => {
    expect(
      origemDe({ recorrenciaId: "r1", parcelamentoId: "p1", recorrencia: { tipoProvisao: "folha" } }),
    ).toBe("parcelado");
  });
});

describe("montarWhere — recorte por origem", () => {
  const hoje = "2026-08-05";

  it("avulso exige AUSENCIA dos dois vinculos", () => {
    const w = montarWhere({ origem: "avulso" }, hoje);
    expect(w.recorrenciaId).toBeNull();
    expect(w.parcelamentoId).toBeNull();
  });

  it("provisao e recorrente se distinguem pelo tipo na recorrencia", () => {
    expect(montarWhere({ origem: "provisao" }, hoje).recorrencia).toEqual({
      is: { tipoProvisao: { not: null } },
    });
    expect(montarWhere({ origem: "recorrente" }, hoje).recorrencia).toEqual({
      is: { tipoProvisao: null },
    });
  });

  it("servico e um booleano, e `false` recorta de verdade", () => {
    // `if (f.servico)` deixaria o `false` cair fora e a aba "nao-servico"
    // mostraria tudo.
    expect(montarWhere({ servico: true }, hoje).ehServico).toBe(true);
    expect(montarWhere({ servico: false }, hoje).ehServico).toBe(false);
    expect(montarWhere({}, hoje).ehServico).toBeUndefined();
  });

  it("a busca alcanca o numero do documento", () => {
    const w = montarWhere({ busca: "NF-123" }, hoje);
    expect(w.OR).toContainEqual({ numeroDocumento: { contains: "NF-123", mode: "insensitive" } });
  });
});
