import { describe, expect, it } from "vitest";
import { OsStatus, type FilaItem } from "@isphub/shared";
import { acaoDoDrop, montarQuadro, paraAgendar, type Parada } from "./despacho";

const parada = (o: Partial<Parada> = {}): Parada => ({
  id: "m1", osId: "os1", sgpOsId: "213346", provedorId: "netgo", turno: "manha",
  tecnicoId: null, tecnicoNome: null, apoios: [], cor: "#1F63B8", categoria: "Instalação",
  equipeExterna: false, fila: "normal",
  local: "Centro", regiao: null, cliente: null, status: OsStatus.ABERTA, ordemRota: null, sla: null,
  confirmadoEm: null, solicitouReagendamento: false, lat: null, lng: null,
  ...o,
});
const tecnicos = [
  { id: "alderi", nome: "Alderi" },
  { id: "dison", nome: "Dison" },
  { id: "iza", nome: "Izarleson" },
  { id: "vitor", nome: "Vitor" },
];

describe("quadro do dia", () => {
  it("'Sem técnico' vem primeiro, mesmo vazio; paradas por ordem da rota", () => {
    const q = montarQuadro(
      [
        parada({ id: "a", tecnicoId: "alderi", tecnicoNome: "Alderi", ordemRota: 2, sgpOsId: "2" }),
        parada({ id: "b", tecnicoId: "alderi", tecnicoNome: "Alderi", ordemRota: 1, sgpOsId: "1" }),
        parada({ id: "c", tecnicoId: "alderi", tecnicoNome: "Alderi", turno: "tarde", sgpOsId: "3" }),
      ],
      tecnicos,
      new Set(),
    );
    expect(q.map((l) => l.nome)).toEqual(["Sem técnico", "Alderi"]);
    expect(q[0]!.manha).toEqual([]);
    expect(q[1]!.manha.map((p) => p.id)).toEqual(["b", "a"]);
    expect(q[1]!.tarde.map((p) => p.id)).toEqual(["c"]);
  });

  it("escalado entra vazio; quem só vai de apoio não ganha linha própria", () => {
    const q = montarQuadro(
      [parada({ tecnicoId: "alderi", tecnicoNome: "Alderi", apoios: [{ id: "iza", nome: "Izarleson" }] })],
      tecnicos,
      new Set(["dison", "iza"]),
    );
    expect(q.map((l) => l.nome)).toEqual(["Sem técnico", "Alderi", "Dison"]);
    expect(q[1]!.apoio).toEqual(["Izarleson"]);
  });

  it("'todos' põe cada técnico ativo; técnico fora da lista entra com o nome da parada", () => {
    const q = montarQuadro([parada({ tecnicoId: "antigo", tecnicoNome: "Fulano" })], tecnicos, new Set(), true);
    expect(q.map((l) => l.nome)).toEqual(["Sem técnico", "Fulano", "Alderi", "Dison", "Izarleson", "Vitor"]);
  });
});

describe("para agendar", () => {
  const item = (id: string, semaforo: FilaItem["sla"]["semaforo"], min: number | null, cadastro: string, dia: string | null = null) =>
    ({ id, diaAgenda: dia, sla: { semaforo, minutosRestantes: min }, dataCadastro: cadastro }) as unknown as FilaItem;

  it("só sem visita; estourado, vencendo, depois as mais antigas", () => {
    const r = paraAgendar([
      item("velha", "sem_sla", null, "2026-09-01"),
      item("verde", "verde", 3000, "2026-10-20"),
      item("estourada", "vermelho", -300, "2026-10-21"),
      item("marcada", "vermelho", -900, "2026-10-01", "2026-10-26"),
      item("vencendo", "amarelo", 90, "2026-10-22"),
      item("nova", "sem_sla", null, "2026-10-23"),
    ]);
    expect(r.map((i) => i.id)).toEqual(["estourada", "vencendo", "verde", "velha", "nova"]);
  });
});

describe("soltar no quadro", () => {
  const aberto = () => null;
  const nova = { tipo: "nova", item: { id: "x" } as FilaItem } as const;

  it("OS nova: marca no turno e atribui o técnico da linha", () => {
    expect(acaoDoDrop(nova, { tecnicoId: "dison", turno: "tarde" }, aberto)).toEqual({ tipo: "fazer", marcarTurno: "tarde", atribuir: "dison" });
    expect(acaoDoDrop(nova, { tecnicoId: null, turno: "manha" }, aberto)).toEqual({ tipo: "fazer", marcarTurno: "manha", atribuir: null });
  });

  it("turno fechado recusa com o motivo", () => {
    expect(acaoDoDrop(nova, { tecnicoId: null, turno: "tarde" }, (t) => (t === "tarde" ? "Sábado só tem manhã" : null))).toEqual({
      tipo: "recusar",
      motivo: "Sábado só tem manhã",
    });
  });

  it("parada: troca de técnico, de turno ou os dois; mesma célula não faz nada", () => {
    const p = { tipo: "parada", parada: parada({ tecnicoId: "alderi" }) } as const;
    expect(acaoDoDrop(p, { tecnicoId: "dison", turno: "manha" }, aberto)).toEqual({ tipo: "fazer", marcarTurno: null, atribuir: "dison" });
    expect(acaoDoDrop(p, { tecnicoId: "alderi", turno: "tarde" }, aberto)).toEqual({ tipo: "fazer", marcarTurno: "tarde", atribuir: null });
    expect(acaoDoDrop(p, { tecnicoId: "dison", turno: "tarde" }, aberto)).toEqual({ tipo: "fazer", marcarTurno: "tarde", atribuir: "dison" });
    expect(acaoDoDrop(p, { tecnicoId: "alderi", turno: "manha" }, aberto)).toEqual({ tipo: "nada" });
  });

  it("recusas: tirar técnico, OS encerrada, OS que ainda não chegou do SGP", () => {
    const comTecnico = { tipo: "parada", parada: parada({ tecnicoId: "alderi" }) } as const;
    expect(acaoDoDrop(comTecnico, { tecnicoId: null, turno: "manha" }, aberto).tipo).toBe("recusar");
    const concluida = { tipo: "parada", parada: parada({ status: OsStatus.CONCLUIDA }) } as const;
    expect(acaoDoDrop(concluida, { tecnicoId: "dison", turno: "manha" }, aberto).tipo).toBe("recusar");
    const orfa = { tipo: "parada", parada: parada({ osId: null }) } as const;
    expect(acaoDoDrop(orfa, { tecnicoId: "dison", turno: "manha" }, aberto).tipo).toBe("recusar");
    expect(acaoDoDrop(orfa, { tecnicoId: null, turno: "tarde" }, aberto)).toEqual({ tipo: "fazer", marcarTurno: "tarde", atribuir: null });
  });
});
