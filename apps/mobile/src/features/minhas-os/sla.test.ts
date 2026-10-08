import { describe, expect, it } from "vitest";
import type { FilaItem } from "@isphub/shared";
import { chaveVisita, compararVisita, inicioDaSemana, janelaVisita } from "@isphub/shared";
import { agruparPorTurno, escolherProxima, maisRecentesPrimeiro, ordenarPorHorario } from "./sla";

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

/** Campos que a agenda le: status, turno/dia/rota da agenda ISPhub e SLA. */
function visita(
  id: string,
  over: Partial<Pick<FilaItem, "status" | "diaAgenda" | "turnoAgenda" | "ordemRota" | "dataAgendamento">> & {
    semaforo?: string;
    minutos?: number | null;
  } = {},
): FilaItem {
  const { semaforo = "verde", minutos = 100, ...resto } = over;
  return { id, status: "aberta", sla: { semaforo, minutosRestantes: minutos }, ...resto } as unknown as FilaItem;
}

describe("helpers de visita do shared (os mesmos do painel)", () => {
  it("compararVisita: dia, depois turno, depois parada; sem visita vai pro fim", () => {
    const ordem = [
      visita("sem", {}),
      visita("tarde-1", { diaAgenda: "2026-10-08", turnoAgenda: "tarde", ordemRota: 1 }),
      visita("manha-2", { diaAgenda: "2026-10-08", turnoAgenda: "manha", ordemRota: 2 }),
      visita("manha-1", { diaAgenda: "2026-10-08", turnoAgenda: "manha", ordemRota: 1 }),
      visita("ontem", { diaAgenda: "2026-10-07", turnoAgenda: "tarde" }),
    ]
      .sort(compararVisita)
      .map((x) => x.id);
    expect(ordem).toEqual(["ontem", "manha-1", "manha-2", "tarde-1", "sem"]);
  });

  it("janelaVisita e chaveVisita", () => {
    expect(janelaVisita("2026-10-07", "2026-10-07")).toBe("hoje");
    expect(janelaVisita("2026-10-08", "2026-10-07")).toBe("amanha");
    expect(janelaVisita("2026-10-14", "2026-10-07")).toBe("semana");
    expect(janelaVisita("2026-10-15", "2026-10-07")).toBe("depois");
    expect(janelaVisita("2026-10-06", "2026-10-07")).toBe("passada");
    expect(chaveVisita({ diaAgenda: "2026-10-08", turnoAgenda: "manha" })).toBe("2026-10-08|manha");
    expect(chaveVisita({})).toBe("sem_visita");
  });

  it("inicioDaSemana: segunda; domingo pertence a semana que termina nele", () => {
    expect(inicioDaSemana("2026-10-07")).toBe("2026-10-05"); // quarta
    expect(inicioDaSemana("2026-10-05")).toBe("2026-10-05"); // segunda
    expect(inicioDaSemana("2026-10-11")).toBe("2026-10-05"); // domingo
  });
});

describe("escolherProxima — a rota manda, o SLA so sem agenda", () => {
  it("com agenda, a primeira parada aberta vence a OS mais urgente da fila", () => {
    const urgente = visita("urgente", { semaforo: "vermelho", minutos: -30 });
    const parada1 = visita("p1", { diaAgenda: "2026-10-07", turnoAgenda: "manha", ordemRota: 1 });
    const parada2 = visita("p2", { diaAgenda: "2026-10-07", turnoAgenda: "manha", ordemRota: 2 });
    expect(escolherProxima([urgente, parada1, parada2], [parada2, parada1])?.id).toBe("p1");
  });

  it("parada ja concluida e pulada: a proxima e a seguinte da rota", () => {
    const feita = visita("feita", { status: "concluida" as never, diaAgenda: "2026-10-07", turnoAgenda: "manha", ordemRota: 1 });
    const p2 = visita("p2", { diaAgenda: "2026-10-07", turnoAgenda: "manha", ordemRota: 2 });
    expect(escolherProxima([p2], [feita, p2])?.id).toBe("p2");
  });

  it("sem agenda (ou toda concluida), cai no SLA da fila aberta", () => {
    const urgente = visita("urgente", { semaforo: "vermelho", minutos: -30 });
    const folgada = visita("folgada", { semaforo: "verde", minutos: 500 });
    expect(escolherProxima([folgada, urgente], [])?.id).toBe("urgente");
    const feita = visita("feita", { status: "concluida" as never, diaAgenda: "2026-10-07", turnoAgenda: "manha" });
    expect(escolherProxima([folgada, urgente], [feita])?.id).toBe("urgente");
  });
});

describe("agruparPorTurno", () => {
  it("separa pela agenda ISPhub e, sem turno, pela hora do SGP no fuso BR", () => {
    const g = agruparPorTurno([
      visita("t", { turnoAgenda: "tarde", ordemRota: 1 }),
      visita("m2", { turnoAgenda: "manha", ordemRota: 2 }),
      visita("m1", { turnoAgenda: "manha", ordemRota: 1 }),
      visita("sgp-manha", { dataAgendamento: "2026-10-07T12:00:00.000Z" }), // 09:00 em Natal
      visita("sgp-tarde", { dataAgendamento: "2026-10-07T17:30:00.000Z" }), // 14:30 em Natal
    ]);
    expect(g.manha.map((x) => x.id)).toEqual(["m1", "m2", "sgp-manha"]);
    expect(g.tarde.map((x) => x.id)).toEqual(["t", "sgp-tarde"]);
  });
});
