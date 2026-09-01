import { describe, expect, it } from "vitest";
import type { FilaItem } from "@isphub/shared";
import { maisRecentesPrimeiro } from "./sla";

/** So os campos que a ordenacao le — o resto do FilaItem nao participa. */
function os(id: string, dataAgendamento: string | null): FilaItem {
  return { id, dataAgendamento } as unknown as FilaItem;
}

describe("maisRecentesPrimeiro", () => {
  it("poe a mais recente na frente", () => {
    const r = maisRecentesPrimeiro([
      os("antiga", "2026-08-01T10:00:00.000Z"),
      os("nova", "2026-08-30T10:00:00.000Z"),
      os("media", "2026-08-15T10:00:00.000Z"),
    ]);
    expect(r.map((x) => x.id)).toEqual(["nova", "media", "antiga"]);
  });

  it("sem data vai pro FIM, nao pro topo", () => {
    // No arquivo, quem procura o servico de ontem nao quer abrir a tela num
    // item sem agendamento nenhum.
    const r = maisRecentesPrimeiro([os("sem-data", null), os("com-data", "2026-08-01T10:00:00.000Z")]);
    expect(r.map((x) => x.id)).toEqual(["com-data", "sem-data"]);
  });

  it("data invalida nao embaralha a lista nem quebra", () => {
    const r = maisRecentesPrimeiro([os("ruim", "nao-e-data"), os("boa", "2026-08-01T10:00:00.000Z")]);
    expect(r.map((x) => x.id)).toEqual(["boa", "ruim"]);
  });

  it("nao muta a lista recebida", () => {
    const original = [os("a", "2026-08-01T10:00:00.000Z"), os("b", "2026-08-30T10:00:00.000Z")];
    maisRecentesPrimeiro(original);
    expect(original.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
