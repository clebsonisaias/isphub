import { describe, expect, it } from "vitest";
import {
  chaveNome,
  ehVagaDeReserva,
  linhaAtiva,
  observacaoDoRobo,
  consolidarLinhas,
  decidirLinha,
  diaDaCelula,
  ehDaPlanilha,
  osDaCelula,
  turnoDaCelula,
  type LinhaPlanilha,
  type MarcacaoAtual,
} from "@isphub/shared";
import { atendentesDaPlanilha, linhasDaPlanilha, resumoRodada, tecnicosDaPlanilha, type RodadaPlanilha } from "./planilhaSyncService.js";

const hoje = "2026-10-22";
const linha = (o: Partial<LinhaPlanilha> = {}): LinhaPlanilha => ({
  os: "213221",
  dia: "2026-10-23",
  turno: "manha",
  status: "Roteirizada",
  atendente: "Marília",
  aba: "instalacao",
  ...o,
});
const marc = (o: Partial<MarcacaoAtual> = {}): MarcacaoAtual => ({
  id: "m1",
  dia: "2026-10-23",
  turno: "manha",
  status: "marcado",
  origem: "planilha",
  observacao: null,
  ...o,
});
const decide = (l: LinhaPlanilha, atual: MarcacaoAtual | null = null, osAberta: boolean | null = true) =>
  decidirLinha({ linha: l, atual, hoje, osAberta });

describe("celulas da planilha", () => {
  it("numero da OS: aceita 'OS-' e espacos, recusa nome e 'ID ...'", () => {
    expect(osDaCelula("OS-212760")).toBe("212760");
    expect(osDaCelula(" 213221 ")).toBe("213221");
    expect(osDaCelula("ID 136279")).toBeNull();
    expect(osDaCelula("")).toBeNull();
    expect(osDaCelula(null)).toBeNull();
  });

  it("data: serial do Excel e dd/mm/aaaa; texto mal digitado vira nulo", () => {
    expect(diaDaCelula(46281)).toBe("2026-09-16");
    expect(diaDaCelula("46281.0")).toBe("2026-09-16");
    expect(diaDaCelula("23/10/2026")).toBe("2026-10-23");
    expect(diaDaCelula("1709/2026")).toBeNull();
    expect(diaDaCelula("31/02/2026")).toBeNull();
    expect(diaDaCelula("")).toBeNull();
    expect(diaDaCelula(25)).toBeNull(); // indice de texto, nao data
  });

  it("turno: Manhã/Tarde, com ou sem acento", () => {
    expect(turnoDaCelula("Manhã")).toBe("manha");
    expect(turnoDaCelula("manha")).toBe("manha");
    expect(turnoDaCelula("Tarde")).toBe("tarde");
    expect(turnoDaCelula("noite")).toBeNull();
  });

  it("e da planilha: origem 'planilha' ou o 1o lote carregado a mao", () => {
    expect(ehDaPlanilha({ origem: "planilha", observacao: null })).toBe(true);
    expect(ehDaPlanilha({ origem: "atendai_humano", observacao: "Migrado da planilha de agendamento (22/10/2026)" })).toBe(true);
    expect(ehDaPlanilha({ origem: "isphub", observacao: null })).toBe(false);
  });
});

describe("consolidar", () => {
  it("OS repetida: vale a ultima linha (a remarcacao)", () => {
    const r = consolidarLinhas([
      linha({ os: "213238", dia: "2026-10-22", turno: "tarde" }),
      linha({ os: "213238", dia: "2026-10-24", turno: "manha" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dia: "2026-10-24", turno: "manha" });
  });

  it("linha ativa vence linha cancelada de outra data, em qualquer ordem (caso real da OS 213238)", () => {
    const ativa24 = linha({ os: "213238", dia: "2026-10-24", turno: "manha", status: "" });
    const cancelada22 = linha({ os: "213238", dia: "2026-10-22", turno: "tarde", status: "Cancelada" });
    expect(consolidarLinhas([ativa24, cancelada22])[0]).toBe(ativa24);
    expect(consolidarLinhas([cancelada22, ativa24])[0]).toBe(ativa24);
  });

  it("so encerradas: vale a ultima; duas ativas: vale a ultima", () => {
    const conc = linha({ os: "1", status: "Concluída" });
    const canc = linha({ os: "1", status: "Cancelada" });
    expect(consolidarLinhas([conc, canc])[0]).toBe(canc);
    const a = linha({ os: "2", dia: "2026-10-23" });
    const b = linha({ os: "2", dia: "2026-10-25" });
    expect(consolidarLinhas([a, b])[0]).toBe(b);
  });
});

describe("decisao por linha", () => {
  it("nova, OS aberta, data futura -> marcar", () => {
    expect(decide(linha())).toEqual({ tipo: "marcar" });
  });

  it("ja marcada igual -> nada (idempotente)", () => {
    expect(decide(linha(), marc())).toEqual({ tipo: "nada" });
  });

  it("planilha remarcou e a marcacao e do robo -> marcar de novo", () => {
    expect(decide(linha({ dia: "2026-10-24" }), marc())).toEqual({ tipo: "marcar" });
  });

  it("ISPhub vale: marcacao de outra origem e diferente -> conflito, nao sobrescreve", () => {
    const d = decide(linha({ dia: "2026-10-24" }), marc({ origem: "isphub" }));
    expect(d.tipo).toBe("conflito");
  });

  it("concluida -> nada, mesmo com marcacao", () => {
    expect(decide(linha({ status: "Concluída" }), marc())).toEqual({ tipo: "nada" });
  });

  it("cancelada desfaz so o que e da planilha", () => {
    expect(decide(linha({ status: "Cancelada" }), marc())).toEqual({ tipo: "desmarcar", id: "m1" });
    expect(decide(linha({ status: "Cancelada" }), marc({ origem: "atendai_ia" }))).toEqual({ tipo: "nada" });
    expect(decide(linha({ status: "Cancelada" }), null)).toEqual({ tipo: "nada" });
  });

  it("sem OS, sem data ou turno invalido -> ignorar com motivo", () => {
    expect(decide(linha({ os: null })).tipo).toBe("ignorar");
    expect(decide(linha({ dia: null })).tipo).toBe("ignorar");
    expect(decide(linha({ turno: null })).tipo).toBe("ignorar");
  });

  it("data passada -> ignorar; mas se ja esta marcada igual, nada", () => {
    expect(decide(linha({ dia: "2026-10-10" }))).toMatchObject({ tipo: "ignorar" });
    expect(decide(linha({ dia: "2026-10-10" }), marc({ dia: "2026-10-10" }))).toEqual({ tipo: "nada" });
  });

  it("OS fechada no espelho -> ignorar; OS ainda nao espelhada -> marca mesmo assim", () => {
    expect(decide(linha(), null, false)).toMatchObject({ tipo: "ignorar" });
    expect(decide(linha(), null, null)).toEqual({ tipo: "marcar" });
  });
});

describe("detalhes da planilha (tecnico, ordem, observacao)", () => {
  it("nome de tecnico compara sem acento, caixa nem apelido", () => {
    expect(chaveNome("Izarleson (Major)")).toBe(chaveNome("izarleson"));
    expect(chaveNome("André Felipe")).toBe("andre felipe");
    expect(chaveNome("Edilson (Muchacho)")).toBe("edilson");
  });

  it("'Tecnico 16'... sao vagas de reserva; nomes reais nao", () => {
    expect(ehVagaDeReserva("Técnico 16")).toBe(true);
    expect(ehVagaDeReserva("Tecnico 25")).toBe(true);
    expect(ehVagaDeReserva("Teobaldo")).toBe(false);
  });

  it("observacao do robo mantem o prefixo que diz que a marcacao e da planilha", () => {
    expect(observacaoDoRobo(null)).toBe("Migrado da planilha (robô)");
    expect(observacaoDoRobo(" Cliente só até 16h ")).toBe("Migrado da planilha (robô) · Cliente só até 16h");
    expect(observacaoDoRobo("x".repeat(600)).length).toBe(500);
  });

  it("linha ativa: vazia/Roteirizada sim; Concluida/Cancelada nao", () => {
    expect(linhaAtiva({ status: "" })).toBe(true);
    expect(linhaAtiva({ status: "Roteirizada" })).toBe(true);
    expect(linhaAtiva({ status: "Concluída" })).toBe(false);
    expect(linhaAtiva({ status: "Cancelada" })).toBe(false);
  });

  it("le tecnico, ordem e observacao quando as colunas existem; sem elas, nulo", () => {
    const cab = ["Nº OS", "Atendente", "Data Agendada", "Turno", "Técnico Designado", "Ordem da Rota", "Status", "Observações"];
    const abas = new Map([["Agendamentos - Reparo", [cab, ["213310", "Marília", 46318, "Manhã", "Dison", 2, "Roteirizada", "portão azul"]]]]);
    expect(linhasDaPlanilha(abas)[0]).toMatchObject({ os: "213310", tecnico: "Dison", ordem: 2, observacao: "portão azul" });
    const sem = new Map([["Agendamentos - Reparo", [["Nº OS", "Atendente", "Data Agendada", "Turno", "Status"], ["1", "Ana", 46318, "Tarde", ""]]]]);
    expect(linhasDaPlanilha(sem)[0]).toMatchObject({ tecnico: null, ordem: null, observacao: null });
  });

  it("lista de tecnicos da aba Configuracoes, sem reservas, ate a primeira celula vazia", () => {
    const abas = new Map([["Configuracoes", [["Parâmetro", "Valor"], [], ["Técnicos (IRLA)", "Atendentes"], ["Alderi", "Anna Clara"], ["Dison", "Marília"], ["Técnico 16"], [null], ["Fora da lista"]]]]);
    expect(tecnicosDaPlanilha(abas)).toEqual(["Alderi", "Dison"]);
    expect(tecnicosDaPlanilha(new Map())).toEqual([]);
  });

  it("lista de atendentes da mesma aba, na coluna Atendentes", () => {
    const abas = new Map([["Configuracoes", [["Técnicos (IRLA)", "Atendentes"], ["Alderi", "Anna Clara"], ["Dison", "Marília"], ["Técnico 16", "Mª Eduarda"], ["Técnico 17"]]]]);
    expect(atendentesDaPlanilha(abas)).toEqual(["Anna Clara", "Marília", "Mª Eduarda"]);
  });
});

describe("log da rodada", () => {
  const base: RodadaPlanilha = {
    quando: new Date(), ativo: true, pulada: null, lidas: 340, marcadas: ["1"], desmarcadas: [], recusadas: [],
    conflitos: [{ os: "2", motivo: "x" }], ignoradas: [], trava: null, erro: null,
    tecnicosCriados: ["Alderi"], atendentesCriados: [], atribuidas: [{ os: "3", tecnico: "Dison" }], detalhesAtualizados: 2,
  };
  it("resume contagens; erro, trava e pulada tem prioridade", () => {
    expect(resumoRodada(base)).toBe("lidas=340 marcadas=1 desmarcadas=0 atribuidas=1 tecnicosCriados=1 atendentesCriadas=0 detalhes=2 conflitos=1 recusadas=0");
    expect(resumoRodada({ ...base, erro: "banco fora" })).toBe("erro: banco fora");
    expect(resumoRodada({ ...base, trava: "31 mudancas" })).toBe("trava: 31 mudancas");
    expect(resumoRodada({ ...base, pulada: "planilha sem alteração" })).toBe("planilha sem alteração");
  });
});
