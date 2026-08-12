import { describe, expect, it } from "vitest";
import {
  placaNoApelido,
  decidirOcupacao,
  formatarPlaca,
  normalizarPlaca,
  odometroMonotonico,
  pesoOrigem,
  placaValida,
  quemEstavaEm,
  veiculoDeEm,
  type PeriodoOcupacao,
} from "@isphub/shared";

/*
 * Mora no workspace da API porque nem `shared` nem `apps/mobile` tem vitest, e
 * acrescentar a ferramenta so por isto seria custo sem retorno. O import e de
 * `@isphub/shared` — o que esta sob teste e a funcao publicada.
 */

describe("normalizarPlaca", () => {
  it("tira hifen, espaco e caixa — as tres sao A MESMA placa", () => {
    /*
     * Se "abc-1234" e "ABC1234" virassem dois veiculos, o vinculo com o
     * rastreador ficaria em um deles e o outro nunca apareceria no mapa, sem
     * erro em lugar nenhum.
     */
    for (const bruta of ["HFX3652", "hfx3652", "HFX-3652", "hfx 3652", " HFX-3652 "]) {
      expect(normalizarPlaca(bruta)).toBe("HFX3652");
    }
  });

  it("normaliza tambem a placa Mercosul", () => {
    expect(normalizarPlaca("noc-4d34")).toBe("NOC4D34");
  });
});

describe("placa escondida no apelido do aparelho", () => {
  it("acha a placa no nome que o fornecedor usa", () => {
    // Os nomes reais da conta vem assim.
    expect(placaNoApelido("C011 - RGI4H16")).toBe("RGI4H16");
    expect(placaNoApelido("C013-DWO2H41")).toBe("DWO2H41");
    expect(placaNoApelido("HFX-3652")).toBe("HFX3652");
  });

  it("nome sem placa devolve null, e nao um palpite", () => {
    /*
     * O apelido nao segue contrato nenhum — quem batizou o aparelho escreveu o
     * que quis. Forcar uma placa daqui nao produz um cadastro feio: produz um
     * rastreador vinculado ao carro de outra pessoa, e dali em diante o mapa, as
     * viagens e o custo por quilometro ficam todos no veiculo errado.
     */
    expect(placaNoApelido("Meu carro")).toBeNull();
    expect(placaNoApelido("C011")).toBeNull();
    expect(placaNoApelido("")).toBeNull();
    expect(placaNoApelido(null)).toBeNull();
  });

  it("DUAS placas no mesmo nome é ambiguidade — ninguém escolhe por você", () => {
    expect(placaNoApelido("RGI4H16 reserva do QGJ4A90")).toBeNull();
  });

  it("a mesma placa repetida não é ambiguidade", () => {
    expect(placaNoApelido("RGI4H16 - RGI4H16")).toBe("RGI4H16");
  });
});

describe("placaValida", () => {
  it("aceita os DOIS formatos que circulam hoje", () => {
    // A frota real tem os dois: HFX3652 (antiga) e NOC4D34 (Mercosul).
    // Aceitar so um rejeitaria metade dos carros.
    expect(placaValida("HFX3652")).toBe(true);
    expect(placaValida("NOC4D34")).toBe(true);
  });

  it("recusa tamanho errado e posicao errada", () => {
    expect(placaValida("HFX365")).toBe(false); // 6
    expect(placaValida("HFX36521")).toBe(false); // 8
    expect(placaValida("1FX3652")).toBe(false); // digito onde vai letra
    expect(placaValida("HFXA652")).toBe(false); // letra onde vai digito (antiga)
  });

  it("recusa a forma nao normalizada — quem valida recebe a canonica", () => {
    // Validar a forma bruta significaria repetir a limpeza aqui, e duas
    // limpezas divergem com o tempo.
    expect(placaValida("HFX-3652")).toBe(false);
    expect(placaValida("hfx3652")).toBe(false);
  });
});

describe("formatarPlaca", () => {
  it("poe hifen so no formato antigo", () => {
    expect(formatarPlaca("HFX3652")).toBe("HFX-3652");
    // A placa Mercosul nao tem hifen; poe-lo ali seria inventar.
    expect(formatarPlaca("NOC4D34")).toBe("NOC4D34");
  });
});

describe("odometroMonotonico", () => {
  it("so anda pra frente", () => {
    // Um digito a menos ("15000" -> "1500") zeraria o historico do veiculo e
    // estragaria todo calculo de consumo depois dele.
    expect(odometroMonotonico(15_000, 1_500)).toBe(15_000);
    expect(odometroMonotonico(15_000, 15_420)).toBe(15_420);
  });

  it("nao saber agora nao apaga o que ja se sabia", () => {
    expect(odometroMonotonico(15_000, null)).toBe(15_000);
    expect(odometroMonotonico(15_000, undefined)).toBe(15_000);
  });

  it("primeiro registro aceita qualquer valor nao negativo", () => {
    expect(odometroMonotonico(null, 15_000)).toBe(15_000);
    expect(odometroMonotonico(null, null)).toBe(null);
  });

  it("ignora lixo em vez de gravar lixo", () => {
    expect(odometroMonotonico(15_000, -3)).toBe(15_000);
    expect(odometroMonotonico(15_000, Number.NaN)).toBe(15_000);
    expect(odometroMonotonico(null, Number.POSITIVE_INFINITY)).toBe(null);
  });
});

describe("decidirOcupacao", () => {
  const jornadaNoA = { veiculoId: "A", papel: "motorista", origem: "jornada" } as const;

  it("sem ocupacao aberta, abre", () => {
    expect(decidirOcupacao(null, jornadaNoA)).toEqual({ tipo: "abrir" });
  });

  it("mesmo veiculo e mesmo papel: nao escreve nada, e nao e erro", () => {
    const atual = { id: "o1", veiculoId: "A", papel: "motorista", origem: "jornada" } as const;
    expect(decidirOcupacao(atual, jornadaNoA)).toEqual({ tipo: "manter" });
  });

  it("o proprio tecnico se declarando em outro carro VENCE a declaracao do colega", () => {
    /*
     * O caso do enunciado: o Joao marcou o Pedro na HFX3652; meia hora depois o
     * Pedro inicia a jornada dele no outro carro. O Pedro sabe melhor onde esta.
     */
    const posto = { id: "o1", veiculoId: "A", papel: "passageiro", origem: "declaracao" } as const;
    expect(decidirOcupacao(posto, { veiculoId: "B", papel: "motorista", origem: "jornada" })).toEqual({
      tipo: "mover",
      fecharOcupacaoId: "o1",
    });
  });

  it("o colega NAO consegue mover quem ja se declarou", () => {
    // O inverso do caso acima — e a tela do Joao precisa DIZER isso em vez de
    // fingir que gravou.
    const proprio = { id: "o9", veiculoId: "B", papel: "motorista", origem: "jornada" } as const;
    expect(decidirOcupacao(proprio, { veiculoId: "A", papel: "passageiro", origem: "declaracao" })).toEqual({
      tipo: "recusar",
      motivo: "declaracao_mais_fraca",
      veiculoIdAtual: "B",
      ocupacaoIdAtual: "o9",
    });
  });

  it("colega sobre colega: vence o ultimo", () => {
    // Dois palpitando; o palpite mais novo e o melhor disponivel.
    const atual = { id: "o1", veiculoId: "A", papel: "passageiro", origem: "declaracao" } as const;
    expect(decidirOcupacao(atual, { veiculoId: "B", papel: "passageiro", origem: "declaracao" })).toEqual({
      tipo: "mover",
      fecharOcupacaoId: "o1",
    });
  });

  it("ajuste do gestor vence tudo", () => {
    const atual = { id: "o1", veiculoId: "A", papel: "motorista", origem: "jornada" } as const;
    expect(decidirOcupacao(atual, { veiculoId: "B", papel: "motorista", origem: "ajuste" })).toEqual({
      tipo: "mover",
      fecharOcupacaoId: "o1",
    });
  });

  it("MESMO veiculo, papel diferente, tambem move", () => {
    /*
     * Sem comparar o papel, o Pedro parado no carro como passageiro declarado
     * nunca conseguiria virar motorista — ficaria em "manter" pra sempre.
     */
    const atual = { id: "o1", veiculoId: "A", papel: "passageiro", origem: "declaracao" } as const;
    expect(decidirOcupacao(atual, { veiculoId: "A", papel: "motorista", origem: "jornada" })).toEqual({
      tipo: "mover",
      fecharOcupacaoId: "o1",
    });
  });

  it("os pesos sao estritamente crescentes", () => {
    expect(pesoOrigem("declaracao")).toBeLessThan(pesoOrigem("jornada"));
    expect(pesoOrigem("jornada")).toBeLessThan(pesoOrigem("ajuste"));
  });
});

describe("quem estava onde, e quando", () => {
  // Joao: HFX3652 das 08:00 as 13:30, depois ABC1234 das 13:30 em diante.
  // Pedro: HFX3652 das 08:04 em diante, sem sair.
  const periodos: PeriodoOcupacao[] = [
    { usuarioId: "joao", veiculoId: "hfx", inicioEm: "2026-08-08T11:00:00.000Z", fimEm: "2026-08-08T16:30:00.000Z" },
    { usuarioId: "joao", veiculoId: "abc", inicioEm: "2026-08-08T16:30:00.000Z", fimEm: null },
    { usuarioId: "pedro", veiculoId: "hfx", inicioEm: "2026-08-08T11:04:00.000Z", fimEm: null },
  ];

  it("as 14:30 (17:30Z) a HFX3652 tem so o Pedro", () => {
    const dentro = quemEstavaEm(periodos, "hfx", new Date("2026-08-08T17:30:00.000Z"));
    expect(dentro.map((p) => p.usuarioId)).toEqual(["pedro"]);
  });

  it("as 09:00 (12:00Z) os dois estavam juntos na HFX3652", () => {
    const dentro = quemEstavaEm(periodos, "hfx", new Date("2026-08-08T12:00:00.000Z"));
    expect(dentro.map((p) => p.usuarioId).sort()).toEqual(["joao", "pedro"]);
  });

  it("as 15:00 (18:00Z) o Joao estava na ABC1234", () => {
    expect(veiculoDeEm(periodos, "joao", new Date("2026-08-08T18:00:00.000Z"))?.veiculoId).toBe("abc");
  });

  it("no INSTANTE EXATO da troca, a pessoa esta em um carro so", () => {
    /*
     * O intervalo e semiaberto `[inicio, fim)`. Com intervalo fechado dos dois
     * lados, as 13:30 em ponto o Joao estaria nos DOIS carros — e "quem estava
     * no carro" perderia a resposta unica exatamente no momento que interessa.
     */
    const troca = new Date("2026-08-08T16:30:00.000Z");
    expect(quemEstavaEm(periodos, "hfx", troca).map((p) => p.usuarioId)).toEqual(["pedro"]);
    expect(veiculoDeEm(periodos, "joao", troca)?.veiculoId).toBe("abc");
  });

  it("antes do inicio, ninguem", () => {
    expect(quemEstavaEm(periodos, "hfx", new Date("2026-08-08T10:00:00.000Z"))).toEqual([]);
    expect(veiculoDeEm(periodos, "joao", new Date("2026-08-08T10:00:00.000Z"))).toBe(null);
  });

  it("ocupacao ainda ABERTA cobre o agora", () => {
    expect(veiculoDeEm(periodos, "pedro", new Date("2030-01-01T00:00:00.000Z"))?.veiculoId).toBe("hfx");
  });
});
