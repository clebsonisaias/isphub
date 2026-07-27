import { describe, expect, it } from "vitest";
import { dataRelevante, prepararFila, type ItemOrdenavel } from "./filaService.js";

function os(id: string, over: Partial<ItemOrdenavel> = {}): ItemOrdenavel & { id: string } {
  return { id, dataAgendamento: null, criadoEm: "2026-07-01T00:00:00.000Z", ...over };
}

describe("dataRelevante", () => {
  it("usa dataAgendamento quando existe, senao criadoEm", () => {
    expect(dataRelevante(os("a", { dataAgendamento: "2026-07-10T00:00:00.000Z" }))).toBe("2026-07-10T00:00:00.000Z");
    expect(dataRelevante(os("b", { dataAgendamento: null, criadoEm: "2026-07-05T00:00:00.000Z" }))).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });
});

describe("prepararFila", () => {
  it("cabe tudo: sem truncamento, total exato, ordenado do mais recente pro mais antigo", () => {
    const itens = [
      os("velha", { dataAgendamento: "2026-07-01T00:00:00.000Z" }),
      os("nova", { dataAgendamento: "2026-07-20T00:00:00.000Z" }),
      os("meio", { dataAgendamento: "2026-07-10T00:00:00.000Z" }),
    ];

    const r = prepararFila(itens, 3, 1000);

    expect(r.truncado).toBe(false);
    expect(r.total).toBe(3);
    expect(r.itens.map((i) => (i as { id: string }).id)).toEqual(["nova", "meio", "velha"]);
  });

  it("truncado quando o take da rota cortou (length < count do banco)", () => {
    // Simula: o banco tem 800 OS, mas a rota so buscou 1 (representando a busca
    // limitada) — o total real vem do count, nao do length.
    const r = prepararFila([os("x")], 800, 1000);

    expect(r.total).toBe(800);
    expect(r.truncado).toBe(true);
  });

  it("truncado quando a lista passa do limite devolvido", () => {
    const itens = [os("a"), os("b"), os("c"), os("d"), os("e")];
    const r = prepararFila(itens, 5, 4); // 5 itens, teto 4

    expect(r.itens).toHaveLength(4);
    expect(r.total).toBe(5);
    expect(r.truncado).toBe(true);
  });

  it("dois provedores misturados: nenhum some so por ordenar depois (regressao do bug)", () => {
    // Antes: filtro de provedor no cliente sobre janela cortada escondia um
    // provedor. Aqui o conjunto vem completo, entao os dois aparecem.
    const citmax = [
      os("citmax-1", { dataAgendamento: null, criadoEm: "2026-06-01T00:00:00.000Z" }), // sem agendamento -> ordena por ultimo
      os("citmax-2", { dataAgendamento: null, criadoEm: "2026-06-02T00:00:00.000Z" }),
    ];
    const netgo = [
      os("netgo-1", { dataAgendamento: "2026-07-25T00:00:00.000Z" }),
      os("netgo-2", { dataAgendamento: "2026-07-24T00:00:00.000Z" }),
    ];
    const r = prepararFila([...netgo, ...citmax], 4, 1000);

    expect(r.truncado).toBe(false);
    const ids = r.itens.map((i) => (i as { id: string }).id);
    expect(ids).toContain("citmax-1");
    expect(ids).toContain("citmax-2");
    expect(ids).toContain("netgo-1");
    expect(ids).toContain("netgo-2");
  });
});
