import { describe, expect, it } from "vitest";
import {
  chaveDeDuplicada,
  classeDaOs,
  destinoDaCandidata,
  ehOsDeTeste,
  ordenarCandidatas,
  proporAgenda,
  separarDuplicadas,
  type CandidataAuto,
  type JanelaPool,
} from "@isphub/shared";

const base: CandidataAuto = {
  provedorId: "p1",
  sgpOsId: "1",
  clienteNome: "Maria",
  categoria: "Reparo",
  equipeExterna: false,
  tipo: "Troca de equipamento",
  prioridade: 2,
  slaEstourado: false,
  dataCadastro: new Date("2026-10-01T10:00:00Z"),
  contratoStatus: "Ativo",
  regiao: "Macaíba",
};
const os = (o: Partial<CandidataAuto>): CandidataAuto => ({ ...base, ...o });

const j = (dia: string, turno: "manha" | "tarde", extra: Partial<JanelaPool> = {}): JanelaPool => ({
  dia,
  turno,
  livresTurno: 5,
  livresDia: Number.POSITIVE_INFINITY,
  naRegiao: 0,
  ...extra,
});

describe("classificacao", () => {
  it("OS de teste e reconhecida so pelo nome do cliente", () => {
    expect(ehOsDeTeste("ATENDAI TESTE APAGAR DOIS")).toBe(true);
    expect(ehOsDeTeste("Maria")).toBe(false);
    expect(ehOsDeTeste(null)).toBe(false);
  });

  it("classe: sem conexao > instalacao > resto, ignorando acento", () => {
    expect(classeDaOs({ tipo: "Sem conexão", categoria: "Reparo" })).toBe(0);
    expect(classeDaOs({ tipo: "Instalação FTTH", categoria: "Instalação" })).toBe(1);
    expect(classeDaOs({ tipo: "Mudança de endereço", categoria: "Outros" })).toBe(2);
  });

  it("sem categoria vai pra revisao; cancelado so entra na retirada", () => {
    expect(destinoDaCandidata(os({ categoria: null }))).toHaveProperty("revisao");
    expect(destinoDaCandidata(os({ contratoStatus: "Cancelado" }))).toHaveProperty("revisao");
    expect(destinoDaCandidata(os({ contratoStatus: "Cancelado", equipeExterna: true }))).toEqual({ fila: "retirada" });
    expect(destinoDaCandidata(os({}))).toEqual({ fila: "normal" });
  });
});

describe("ordenacao", () => {
  it("classe, depois prioridade, SLA estourado e idade", () => {
    const ordem = ordenarCandidatas([
      os({ sgpOsId: "velha", dataCadastro: new Date("2026-09-01") }),
      os({ sgpOsId: "nova", dataCadastro: new Date("2026-10-10") }),
      os({ sgpOsId: "sla", slaEstourado: true, dataCadastro: new Date("2026-10-15") }),
      os({ sgpOsId: "alta", prioridade: 3, dataCadastro: new Date("2026-10-20") }),
      os({ sgpOsId: "inst", tipo: "Instalação", categoria: "Instalação", dataCadastro: new Date("2026-10-21") }),
      os({ sgpOsId: "semcon", tipo: "Sem conexão", dataCadastro: new Date("2026-10-22") }),
    ]).map((c) => c.sgpOsId);
    expect(ordem).toEqual(["semcon", "inst", "alta", "sla", "velha", "nova"]);
  });
});

describe("proporAgenda", () => {
  const dia1 = "2026-10-26";
  const dia2 = "2026-10-27";

  it("preenche a primeira vaga e separa revisao", () => {
    const r = proporAgenda({
      candidatas: [os({ sgpOsId: "a" }), os({ sgpOsId: "b", categoria: null }), os({ sgpOsId: "t", clienteNome: "TESTE" })],
      normal: new Map([["Macaíba", [j(dia1, "manha")]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas).toMatchObject([{ sgpOsId: "a", dia: dia1, turno: "manha", fila: "normal" }]);
    expect(r.revisao.map((x) => x.sgpOsId)).toEqual(["b"]);
  });

  it("concentra na janela que ja tem a regiao, em vez da mais cedo", () => {
    const r = proporAgenda({
      candidatas: [os({})],
      normal: new Map([["Macaíba", [j(dia1, "manha"), j(dia1, "tarde", { naRegiao: 3 })]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas[0]).toMatchObject({ dia: dia1, turno: "tarde" });
    expect(r.propostas[0]!.motivo).toContain("junto de 3 visitas em Macaíba");
  });

  it("tetoRegiao e duro: a concentracao nao fura o teto, inclusive dentro do lote", () => {
    const r = proporAgenda({
      candidatas: [os({ sgpOsId: "a" }), os({ sgpOsId: "b" }), os({ sgpOsId: "c" })],
      normal: new Map([["Macaíba", [j(dia1, "manha", { naRegiao: 1 }), j(dia2, "manha")]]]),
      retirada: new Map(),
      tetoRegiao: 2,
    });
    // dia1 comporta so mais 1 da regiao (1 existente + 1 = teto 2); o resto vai pro dia2.
    expect(r.propostas.map((p) => p.dia)).toEqual([dia1, dia2, dia2]);
  });

  it("respeita a capacidade do turno e o teto do dia dentro do lote", () => {
    const r = proporAgenda({
      candidatas: [os({ sgpOsId: "a" }), os({ sgpOsId: "b" }), os({ sgpOsId: "c" })],
      normal: new Map([
        ["Macaíba", [j(dia1, "manha", { livresTurno: 1, livresDia: 2 }), j(dia1, "tarde", { livresTurno: 5, livresDia: 2 })]],
      ]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas.map((p) => `${p.dia}|${p.turno}`)).toEqual([`${dia1}|manha`, `${dia1}|tarde`]);
    expect(r.semVaga.map((s) => s.sgpOsId)).toEqual(["c"]);
  });

  it("retirada vem depois das demais, usa a sobra e nunca passa do teto do dia", () => {
    // teto do dia = 3 (livresDia). Normal pega 2; sobra 1 pra retirada.
    const janelas = (): JanelaPool[] => [j(dia1, "manha", { livresDia: 3 }), j(dia1, "tarde", { livresDia: 3 })];
    const r = proporAgenda({
      candidatas: [
        os({ sgpOsId: "r1", equipeExterna: true, categoria: "Retirada", tipo: "Sem conexão" }), // classe alta, mas e retirada
        os({ sgpOsId: "r2", equipeExterna: true, categoria: "Retirada" }),
        os({ sgpOsId: "n1" }),
        os({ sgpOsId: "n2" }),
      ],
      normal: new Map([["Macaíba", janelas()]]),
      retirada: new Map([["Macaíba", janelas()]]),
      tetoRegiao: null,
    });
    expect(r.propostas.filter((p) => p.fila === "normal")).toHaveLength(2);
    expect(r.propostas.filter((p) => p.fila === "retirada").map((p) => p.sgpOsId)).toEqual(["r1"]);
    expect(r.semVaga.map((s) => s.sgpOsId)).toEqual(["r2"]);
  });

  it("a fatia reservada (livresDia da fila normal ja descontada) fica pra retirada", () => {
    // normal enxerga 1 livre no dia (3 - reserva 2); retirada enxerga as 3.
    const r = proporAgenda({
      candidatas: [
        os({ sgpOsId: "n1" }),
        os({ sgpOsId: "n2" }),
        os({ sgpOsId: "r1", equipeExterna: true, categoria: "Retirada" }),
        os({ sgpOsId: "r2", equipeExterna: true, categoria: "Retirada" }),
      ],
      normal: new Map([["Macaíba", [j(dia1, "manha", { livresDia: 1 })]]]),
      retirada: new Map([["Macaíba", [j(dia1, "manha", { livresDia: 3 })]]]),
      tetoRegiao: null,
    });
    expect(r.propostas.map((p) => p.sgpOsId)).toEqual(["n1", "r1", "r2"]);
    expect(r.semVaga.map((s) => s.sgpOsId)).toEqual(["n2"]);
  });

  it("sem cota de retirada configurada, a retirada fica sem vaga (nao invade a fila normal)", () => {
    const r = proporAgenda({
      candidatas: [os({ equipeExterna: true, categoria: "Retirada" })],
      normal: new Map([["Macaíba", [j(dia1, "manha")]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas).toHaveLength(0);
    expect(r.semVaga).toEqual([{ provedorId: "p1", sgpOsId: "1", fila: "retirada" }]);
  });
});

describe("higiene da entrada", () => {
  it("contrato suspenso ou bloqueado e financeiro: vai pra revisao", () => {
    expect(destinoDaCandidata(os({ contratoStatus: " Suspenso" }))).toHaveProperty("revisao");
    expect(destinoDaCandidata(os({ contratoStatus: "Bloqueado" }))).toHaveProperty("revisao");
    expect(destinoDaCandidata(os({ contratoStatus: " Ativo " }))).toEqual({ fila: "normal" });
  });

  it("OS duplicada (mesmo contrato e tipo): agenda a mais antiga, a outra vai pra revisao", () => {
    const velha = os({ sgpOsId: "velha", contratoId: "9", dataCadastro: new Date("2026-09-01") });
    const nova = os({ sgpOsId: "nova", contratoId: "9", dataCadastro: new Date("2026-10-10") });
    const outroTipo = os({ sgpOsId: "outro", contratoId: "9", tipo: "Instalação" });
    const semContrato = os({ sgpOsId: "sc", contratoId: null });
    const { unicas, duplicadas } = separarDuplicadas([nova, velha, outroTipo, semContrato]);
    expect(duplicadas.map((c) => c.sgpOsId)).toEqual(["nova"]);
    expect(unicas.map((c) => c.sgpOsId).sort()).toEqual(["outro", "sc", "velha"]);
  });

  it("proporAgenda manda a duplicada pra revisao e nao gasta vaga com ela", () => {
    const r = proporAgenda({
      candidatas: [
        os({ sgpOsId: "a", contratoId: "9", dataCadastro: new Date("2026-09-01") }),
        os({ sgpOsId: "b", contratoId: "9", dataCadastro: new Date("2026-10-01") }),
      ],
      normal: new Map([["Macaíba", [j("2026-11-02", "manha", { livresTurno: 1 })]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas.map((p) => p.sgpOsId)).toEqual(["a"]);
    expect(r.revisao.map((x) => x.sgpOsId)).toEqual(["b"]);
    expect(r.semVaga).toHaveLength(0);
  });
});

describe("duplicada de OS que ja tem visita", () => {
  it("OS do mesmo contrato e tipo de uma visita ja marcada vai pra revisao, nao ganha vaga", () => {
    const r = proporAgenda({
      candidatas: [os({ sgpOsId: "dup", contratoId: "9", duplicaMarcada: true })],
      normal: new Map([["Macaíba", [j("2026-11-02", "manha")]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas).toHaveLength(0);
    expect(r.revisao.map((x) => x.sgpOsId)).toEqual(["dup"]);
  });

  it("a chave ignora acento e caixa e some sem contrato", () => {
    expect(chaveDeDuplicada("p", "9", "Sem Conexão")).toBe(chaveDeDuplicada("p", "9", "sem conexao"));
    expect(chaveDeDuplicada("p", null, "x")).toBeNull();
  });
});

describe("reserva de urgencia", () => {
  const dia = "2026-11-02";
  const semConexao = (id: string) => os({ sgpOsId: id, tipo: "Sem conexão", regiao: "Macaíba" });
  const comum = (id: string) => os({ sgpOsId: id, tipo: "Troca de equipamento", regiao: "Macaíba" });

  it("a OS comum nao ocupa a reserva; a urgente ocupa", () => {
    // 2 vagas no dia, 1 guardada pra urgencia: a comum cabe 1, a segunda comum nao.
    const r = proporAgenda({
      candidatas: [comum("c1"), comum("c2"), semConexao("u1")],
      normal: new Map([["Macaíba", [j(dia, "manha", { livresDia: 2, reservaUrgencia: 1 })]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas.map((p) => p.sgpOsId).sort()).toEqual(["c1", "u1"]);
    expect(r.semVaga.map((s) => s.sgpOsId)).toEqual(["c2"]);
  });

  it("sem reserva configurada, tudo se comporta como antes", () => {
    const r = proporAgenda({
      candidatas: [comum("c1"), comum("c2")],
      normal: new Map([["Macaíba", [j(dia, "manha", { livresDia: 2 })]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas).toHaveLength(2);
  });

  it("a urgente que ja foi posta libera o resto da reserva do dia", () => {
    // reserva 1, urgente chega primeiro (ordem de prioridade) e a comum entao cabe.
    const r = proporAgenda({
      candidatas: [semConexao("u1"), comum("c1")],
      normal: new Map([["Macaíba", [j(dia, "manha", { livresDia: 2, reservaUrgencia: 1 })]]]),
      retirada: new Map(),
      tetoRegiao: null,
    });
    expect(r.propostas.map((p) => p.sgpOsId).sort()).toEqual(["c1", "u1"]);
  });
});
