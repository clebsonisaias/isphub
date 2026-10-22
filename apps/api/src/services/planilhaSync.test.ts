import { describe, expect, it } from "vitest";
import {
  consolidarLinhas,
  decidirLinha,
  diaDaCelula,
  ehDaPlanilha,
  osDaCelula,
  turnoDaCelula,
  type LinhaPlanilha,
  type MarcacaoAtual,
} from "@isphub/shared";

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
