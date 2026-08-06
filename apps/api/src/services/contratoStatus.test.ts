import { describe, expect, it } from "vitest";
import {
  UserRole,
  alvosPermitidos,
  codigoDoTexto,
  ehAtivo,
  ehInativo,
  rotuloDoTexto,
  transicaoPermitida,
} from "@isphub/shared";

/*
 * O TEXTO DO SGP E CRU, E A ARMADILHA E DE UMA LETRA.
 *
 * `"inativo".includes("ativo")` e TRUE. Um casamento por substring responde
 * "ativo" pra um contrato inativo — que e exatamente o unico caso que o tecnico
 * pode mexer. O efeito seria invertido de ponta a ponta: o botao de reativar
 * aparece onde nao devia e some depois de funcionar.
 *
 * "Ativo V. Reduzida" e o segundo caso: contem "ativo" e NAO e contrato normal.
 */

describe("codigoDoTexto — casamento por palavra, nunca por substring", () => {
  it("nao confunde inativo com ativo", () => {
    expect(codigoDoTexto("Inativo")).toBe(2);
    expect(codigoDoTexto("Ativo")).toBe(1);
    // A prova de que a armadilha existe:
    expect("inativo".includes("ativo")).toBe(true);
  });

  it("reconhece o texto real que o SGP manda", () => {
    expect(codigoDoTexto("Contrato Inativo")).toBe(2);
    expect(codigoDoTexto("Ativo V. Reduzida")).toBe(7);
    expect(codigoDoTexto("Cancelado")).toBe(3);
    expect(codigoDoTexto("Suspenso")).toBe(4);
  });

  it("velocidade reduzida ganha de ativo, e nao e contrato normal", () => {
    // Se "ativo" fosse testado primeiro, um contrato com velocidade cortada por
    // inadimplencia passaria por normal.
    expect(codigoDoTexto("Ativo V. Reduzida")).not.toBe(1);
    expect(ehAtivo("Ativo V. Reduzida")).toBe(false);
    expect(ehInativo("Ativo V. Reduzida")).toBe(false);
  });

  it("ignora caixa, acento e espaco", () => {
    expect(codigoDoTexto("ATIVO")).toBe(1);
    expect(codigoDoTexto("  ativo  ")).toBe(1);
    expect(codigoDoTexto("Inviabilidade Técnica")).toBe(5);
    expect(codigoDoTexto("inviabilidade tecnica")).toBe(5);
  });

  it("aceita a forma feminina", () => {
    expect(codigoDoTexto("Cancelada")).toBe(3);
    expect(codigoDoTexto("Suspensa")).toBe(4);
    expect(codigoDoTexto("Inativa")).toBe(2);
  });

  it("texto desconhecido devolve null em vez de chutar", () => {
    // Cada SGP nomeia do seu jeito. Inventar um codigo aqui escreveria status
    // errado no ERP do provedor — `null` e a resposta honesta.
    expect(codigoDoTexto("Aguardando vistoria")).toBeNull();
    expect(codigoDoTexto("")).toBeNull();
    expect(codigoDoTexto(null)).toBeNull();
    expect(codigoDoTexto(undefined)).toBeNull();
  });

  it("nao casa palavra colada em outra", () => {
    // `\b` e o que separa; sem ele, qualquer texto com "ativo" no meio casaria.
    expect(codigoDoTexto("desativoU")).toBeNull();
  });
});

describe("rotuloDoTexto", () => {
  it("normaliza o que reconhece", () => {
    expect(rotuloDoTexto("Contrato Inativo")).toBe("Inativo");
    expect(rotuloDoTexto("Ativo V. Reduzida")).toBe("Velocidade reduzida");
  });

  it("mostra o texto CRU quando nao reconhece", () => {
    // Esconder o que o SGP disse seria pior do que exibir um rotulo fora da
    // nossa lista — quem esta na tela precisa saber o que o ERP acha.
    expect(rotuloDoTexto("Aguardando vistoria")).toBe("Aguardando vistoria");
    expect(rotuloDoTexto(null)).toBe("—");
  });
});

describe("transicaoPermitida — admin e supervisor", () => {
  for (const role of [UserRole.ADMIN, UserRole.GESTOR] as const) {
    it(`${role} muda para qualquer status`, () => {
      expect(transicaoPermitida(role, "Ativo", 3).permitido).toBe(true);
      expect(transicaoPermitida(role, "Cancelado", 1).permitido).toBe(true);
      expect(transicaoPermitida(role, "Suspenso", 7).permitido).toBe(true);
    });

    it(`${role} muda mesmo com o status atual desconhecido`, () => {
      // E justamente ai que alguem precisa corrigir o contrato pra um valor
      // conhecido — travar seria deixar o contrato preso no texto estranho.
      expect(transicaoPermitida(role, "Aguardando vistoria", 1).permitido).toBe(true);
      expect(transicaoPermitida(role, null, 1).permitido).toBe(true);
    });
  }

  it("mas ninguem 'muda' pro status que ja esta", () => {
    const r = transicaoPermitida(UserRole.ADMIN, "Ativo", 1);
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.motivo).toBe("sem_mudanca");
  });
});

describe("transicaoPermitida — tecnico", () => {
  it("reativa contrato inativo", () => {
    expect(transicaoPermitida(UserRole.TECNICO, "Inativo", 1).permitido).toBe(true);
    expect(transicaoPermitida(UserRole.TECNICO, "Contrato Inativo", 1).permitido).toBe(true);
  });

  it("NAO reativa suspenso — e o caso do inadimplente que acabou de pagar", () => {
    const r = transicaoPermitida(UserRole.TECNICO, "Suspenso", 1);
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.motivo).toBe("transicao_nao_permitida");
  });

  it("NAO reativa cancelado", () => {
    expect(transicaoPermitida(UserRole.TECNICO, "Cancelado", 1).permitido).toBe(false);
  });

  it("NAO desativa, cancela nem suspende — o poder e de mao unica", () => {
    for (const alvo of [2, 3, 4, 5, 6, 7] as const) {
      expect(transicaoPermitida(UserRole.TECNICO, "Ativo", alvo).permitido).toBe(false);
    }
  });

  it("com status desconhecido nao anda (fail-closed)", () => {
    const r = transicaoPermitida(UserRole.TECNICO, "Aguardando vistoria", 1);
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.motivo).toBe("status_atual_desconhecido");
  });

  it("velocidade reduzida NAO conta como inativo", () => {
    // Se o casamento fosse por substring, "Ativo V. Reduzida" viraria ativo e
    // este caso passaria despercebido nos dois sentidos.
    expect(transicaoPermitida(UserRole.TECNICO, "Ativo V. Reduzida", 1).permitido).toBe(false);
  });
});

describe("transicaoPermitida — provedor", () => {
  it("nao muda nada", () => {
    for (const alvo of [1, 2, 3, 4, 5, 6, 7] as const) {
      const r = transicaoPermitida(UserRole.PROVEDOR, "Inativo", alvo);
      expect(r.permitido).toBe(false);
      if (!r.permitido) expect(r.motivo).toBe("papel_sem_permissao");
    }
  });
});

describe("alvosPermitidos — o que a tela oferece", () => {
  it("admin ve todos menos o atual", () => {
    expect(alvosPermitidos(UserRole.ADMIN, "Ativo")).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("tecnico ve UMA opcao em contrato inativo", () => {
    expect(alvosPermitidos(UserRole.TECNICO, "Inativo")).toEqual([1]);
  });

  it("tecnico ve NENHUMA nos demais — o botao nem aparece", () => {
    expect(alvosPermitidos(UserRole.TECNICO, "Ativo")).toEqual([]);
    expect(alvosPermitidos(UserRole.TECNICO, "Suspenso")).toEqual([]);
    expect(alvosPermitidos(UserRole.TECNICO, "Cancelado")).toEqual([]);
    expect(alvosPermitidos(UserRole.TECNICO, null)).toEqual([]);
  });

  it("provedor ve nenhuma, sempre", () => {
    expect(alvosPermitidos(UserRole.PROVEDOR, "Inativo")).toEqual([]);
  });
});
