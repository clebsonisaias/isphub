import { describe, expect, it } from "vitest";
import type { FilaItem } from "@isphub/shared";
import { maisRecentesPrimeiro, ordenarPorHorario } from "./sla";

/** So os campos que a ordenacao le — o resto do FilaItem nao participa. */
function os(id: string, dataAgendamento: string | null, ordemRota: number | null = null): FilaItem {
  return { id, dataAgendamento, ordemRota } as unknown as FilaItem;
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

describe("ordenarPorHorario", () => {
  it("cedo primeiro", () => {
    const r = ordenarPorHorario([
      os("tarde", "2026-08-01T18:00:00.000Z"),
      os("cedo", "2026-08-01T07:00:00.000Z"),
      os("meio", "2026-08-01T12:00:00.000Z"),
    ]);
    expect(r.map((x) => x.id)).toEqual(["cedo", "meio", "tarde"]);
  });

  it("a rota do supervisor ganha do horario", () => {
    // O supervisor sequenciou pensando no caminho; reordenar por horario por
    // cima disso devolveria o tecnico ao zigue-zague.
    const r = ordenarPorHorario([
      os("segunda-parada", "2026-08-01T07:00:00.000Z", 2),
      os("primeira-parada", "2026-08-01T18:00:00.000Z", 1),
    ]);
    expect(r.map((x) => x.id)).toEqual(["primeira-parada", "segunda-parada"]);
  });

  it("sem rota, cai no horario — e quem tem rota vem antes de quem nao tem", () => {
    const r = ordenarPorHorario([
      os("sem-rota-tarde", "2026-08-01T18:00:00.000Z"),
      os("sem-rota-cedo", "2026-08-01T07:00:00.000Z"),
      os("roteirizada", "2026-08-01T20:00:00.000Z", 1),
    ]);
    expect(r.map((x) => x.id)).toEqual(["roteirizada", "sem-rota-cedo", "sem-rota-tarde"]);
  });

  it("sem horario vai pro fim, onde nao atrapalha a leitura", () => {
    const r = ordenarPorHorario([os("sem-hora", null), os("com-hora", "2026-08-01T07:00:00.000Z")]);
    expect(r.map((x) => x.id)).toEqual(["com-hora", "sem-hora"]);
  });

  it("data invalida cai junto das sem horario, em vez de embaralhar a agenda", () => {
    // Mesmo defeito de NaN da funcao irma: aqui o sintoma seria a linha do
    // tempo do dia fora de ordem, sem nenhum erro na tela.
    const r = ordenarPorHorario([os("ruim", "nao-e-data"), os("boa", "2026-08-01T07:00:00.000Z")]);
    expect(r.map((x) => x.id)).toEqual(["boa", "ruim"]);
  });
});
