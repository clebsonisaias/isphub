import { describe, expect, it } from "vitest";
import { dataRelevante, mesclarFila, type ItemMesclavel } from "./filaService.js";

function os(id: string, over: Partial<ItemMesclavel> = {}): ItemMesclavel & { id: string } {
  return { id, kind: "os", dataAgendamento: null, criadoEm: "2026-07-01T00:00:00.000Z", ...over };
}
function oco(id: string, over: Partial<ItemMesclavel> = {}): ItemMesclavel & { id: string } {
  return { id, kind: "ocorrencia", dataAgendamento: null, dataCadastro: "2026-07-01T00:00:00.000Z", ...over };
}

describe("dataRelevante", () => {
  it("OS: usa dataAgendamento quando existe, senao criadoEm", () => {
    expect(dataRelevante(os("a", { dataAgendamento: "2026-07-10T00:00:00.000Z" }))).toBe("2026-07-10T00:00:00.000Z");
    expect(dataRelevante(os("b", { dataAgendamento: null, criadoEm: "2026-07-05T00:00:00.000Z" }))).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });

  it("ocorrencia: usa dataAgendamento, senao dataCadastro", () => {
    expect(dataRelevante(oco("c", { dataAgendamento: null, dataCadastro: "2026-07-03T00:00:00.000Z" }))).toBe(
      "2026-07-03T00:00:00.000Z",
    );
  });
});

describe("mesclarFila", () => {
  it("cabe tudo: sem truncamento, total exato, ordenado do mais recente pro mais antigo", () => {
    const itensOs = [
      os("velha", { dataAgendamento: "2026-07-01T00:00:00.000Z" }),
      os("nova", { dataAgendamento: "2026-07-20T00:00:00.000Z" }),
    ];
    const itensOco = [oco("meio", { dataAgendamento: "2026-07-10T00:00:00.000Z" })];

    const r = mesclarFila(itensOs, itensOco, 2, 1, 1000);

    expect(r.truncado).toBe(false);
    expect(r.total).toBe(3);
    expect(r.itens.map((i) => (i as { id: string }).id)).toEqual(["nova", "meio", "velha"]);
  });

  it("truncado quando o take da rota cortou uma tabela (length < count do banco)", () => {
    // Simula: o banco tem 800 OS, mas a rota so buscou 500 (itensOs.length=1 aqui,
    // representando a busca limitada) — o total real vem do count, nao do length.
    const itensOs = [os("x")];
    const r = mesclarFila(itensOs, [], 800, 0, 1000);

    expect(r.total).toBe(800);
    expect(r.truncado).toBe(true);
  });

  it("truncado quando a mesclagem passa do limite devolvido", () => {
    const itensOs = [os("a"), os("b"), os("c")];
    const itensOco = [oco("d"), oco("e")];
    const r = mesclarFila(itensOs, itensOco, 3, 2, 4); // 5 itens, teto 4

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
    const r = mesclarFila([...netgo, ...citmax], [], 4, 0, 1000);

    expect(r.truncado).toBe(false);
    const ids = r.itens.map((i) => (i as { id: string }).id);
    expect(ids).toContain("citmax-1");
    expect(ids).toContain("citmax-2");
    expect(ids).toContain("netgo-1");
    expect(ids).toContain("netgo-2");
  });
});
