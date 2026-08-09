import { describe, expect, it } from "vitest";
import {
  DURACAO_MAXIMA_PLAUSIVEL_MIN,
  MINIMO_AMOSTRAS_PESO,
  PESO_MAXIMO,
  classificarExpediente,
  duracaoOsMin,
  pesoDoTipo,
  pontuar,
} from "@isphub/shared";

/**
 * As regras da produtividade.
 *
 * Diferente dos outros specs do projeto, o dano que estes testes evitam nao e
 * um numero errado num painel: e um numero errado ao lado do NOME de uma
 * pessoa. Cada caso aqui e uma injustica concreta que a regra impede.
 */

describe("peso do tipo de OS", () => {
  it("uma instalação vale mais que uma retirada — e a razão sai da própria operação", () => {
    /*
     * A injustica que este peso existe pra evitar: num ranking por CONTAGEM,
     * quem passa o dia em instalacao fecha tres e quem passa o dia em retirada
     * fecha dez. O unico jeito de subir seria recusar o trabalho dificil.
     */
    const geral = 45;
    const instalacao = pesoDoTipo([90, 95, 88, 92, 91], geral);
    const retirada = pesoDoTipo([20, 22, 18, 21, 19], geral);
    expect(instalacao).toBeCloseTo(2.02, 2);
    expect(retirada).toBeCloseTo(0.44, 2);
  });

  it("abaixo do mínimo de amostras NÃO inventa peso", () => {
    /*
     * Com quatro amostras o numero sai, e sai plausivel — que e justamente o
     * perigo. Um palpite com cara de medicao, ao lado do nome de alguem.
     */
    expect(pesoDoTipo([90, 95, 88, 92], 45)).toBeNull();
    expect(pesoDoTipo([90, 95, 88, 92, 91], 45)).not.toBeNull();
    expect(MINIMO_AMOSTRAS_PESO).toBe(5);
  });

  it("um tipo não pode valer vinte vezes outro por causa de um caso", () => {
    // Teto: uma OS de 12h contra uma mediana de 10min daria peso 72.
    expect(pesoDoTipo([700, 710, 690, 705, 695], 10)).toBe(PESO_MAXIMO);
  });

  it("sem mediana geral não há razão — nunca 1,0 implícito", () => {
    expect(pesoDoTipo([90, 95, 88, 92, 91], null)).toBeNull();
    expect(pesoDoTipo([90, 95, 88, 92, 91], 0)).toBeNull();
  });
});

describe("duração da OS", () => {
  it("conta do 'a caminho', não da abertura", () => {
    /*
     * Entre abrir e despachar pode haver dias de fila, e fila nao e trabalho de
     * tecnico. Medir da abertura puniria quem pega a OS mais antiga — que e
     * exatamente quem se quer premiar.
     */
    const aCaminho = new Date("2026-08-09T13:00:00Z");
    const fechou = new Date("2026-08-09T14:30:00Z");
    expect(duracaoOsMin(aCaminho, fechou)).toBe(90);
  });

  it("a OS 'de 18 horas' fica de fora — é alguém que esqueceu de fechar", () => {
    /*
     * Deixa-la entrar nao estraga so a linha dela: ela arrasta a mediana do
     * TIPO, e com isso o peso de todo mundo que faz aquele tipo de servico.
     */
    const ini = new Date("2026-08-09T08:00:00Z");
    const fim = new Date("2026-08-10T02:00:00Z");
    expect(duracaoOsMin(ini, fim)).toBeNull();
    expect(DURACAO_MAXIMA_PLAUSIVEL_MIN).toBe(720);
  });

  it("relógio que anda para trás não vira duração negativa", () => {
    const ini = new Date("2026-08-09T14:00:00Z");
    const fim = new Date("2026-08-09T13:00:00Z");
    expect(duracaoOsMin(ini, fim)).toBeNull();
  });

  it("faltando uma ponta, não há duração", () => {
    expect(duracaoOsMin(null, new Date())).toBeNull();
    expect(duracaoOsMin(new Date(), null)).toBeNull();
  });
});

describe("pontuação", () => {
  it("soma os pesos, e conta separado o que entrou sem peso", () => {
    const p = pontuar([
      { tipoOsId: "a", peso: 2, peloApp: true },
      { tipoOsId: "b", peso: 0.5, peloApp: true },
      { tipoOsId: "c", peso: null, peloApp: false },
    ]);
    expect(p.concluidas).toBe(3);
    expect(p.pontos).toBe(3.5);
    expect(p.semPeso).toBe(1);
    expect(p.calibrado).toBe(false);
  });

  it("OS de tipo sem amostra vale 1,0 — descartá-la puniria o técnico por uma lacuna que não é dele", () => {
    const p = pontuar([{ tipoOsId: null, peso: null, peloApp: true }]);
    expect(p.pontos).toBe(1);
    expect(p.calibrado).toBe(false);
  });

  it("quem não fechou nada não está 'calibrado' — está sem dado", () => {
    // Zero OS com `calibrado: true` faria a tela exibir um zero confiante.
    expect(pontuar([]).calibrado).toBe(false);
  });
});

describe("expediente", () => {
  const dia = (h: number) => new Date(`2026-08-09T${String(h).padStart(2, "0")}:00:00Z`);

  it("quem nunca abriu jornada não é o mesmo que quem fechou fora dela", () => {
    /*
     * A distincao que evita acusar todo mundo do mesmo: nao registrar jornada e
     * falta de habito com o app; fechar depois de encerrar o ponto e hora extra
     * ou esquecimento. Colapsar os dois em "fora da jornada" trata uma coisa
     * como a outra.
     */
    expect(classificarExpediente(dia(15), [])).toEqual({ tipo: "nao_registrou" });
    expect(classificarExpediente(dia(20), [{ inicioEm: dia(8), fimEm: dia(18) }])).toEqual({ tipo: "fora" });
  });

  it("o intervalo é semiaberto — ninguém está em dois turnos ao mesmo tempo", () => {
    const manha = { inicioEm: dia(8), fimEm: dia(13) };
    const tarde = { inicioEm: dia(13), fimEm: dia(18) };
    // As 13h em ponto pertence a TARDE, e so a ela.
    expect(classificarExpediente(dia(13), [manha])).toEqual({ tipo: "fora" });
    expect(classificarExpediente(dia(13), [tarde])).toEqual({ tipo: "dentro" });
  });

  it("jornada ainda aberta cobre o fechamento", () => {
    expect(classificarExpediente(dia(15), [{ inicioEm: dia(8), fimEm: null }])).toEqual({ tipo: "dentro" });
  });
});
