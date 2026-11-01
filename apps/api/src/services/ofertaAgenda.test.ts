import { describe, expect, it } from "vitest";
import { decidir, dentroDaJanela, INTERVALO_MS, MAX_POR_RODADA, MAX_TENTATIVAS, type OsCandidata } from "./ofertaAgendaService.js";

const agora = new Date("2026-11-03T13:00:00Z"); // 10h em Brasilia
const os = (sgpOsId: string, extra: Partial<OsCandidata> = {}): OsCandidata => ({
  provedorId: "p1",
  sgpOsId,
  telefone: "84 99999-1234",
  marcada: false,
  ...extra,
});
const oferta = (sgpOsId: string, tentativas: number, horasAtras: number | null, status = "enviada") => ({
  provedorId: "p1",
  sgpOsId,
  tentativas,
  ultimaEm: horasAtras == null ? null : new Date(agora.getTime() - horasAtras * 3_600_000),
  status,
});

describe("decidir", () => {
  it("OS nova com telefone recebe a primeira oferta", () => {
    expect(decidir([os("1")], [], agora).enviar.map((o) => o.sgpOsId)).toEqual(["1"]);
  });

  it("sem telefone valido nao envia (espera o backfill)", () => {
    const d = decidir([os("1", { telefone: null }), os("2", { telefone: "123" })], [], agora);
    expect(d.enviar).toEqual([]);
  });

  it("ja marcada nao recebe oferta e fecha a oferta aberta como agendada", () => {
    const d = decidir([os("1", { marcada: true }), os("2", { marcada: true })], [oferta("1", 1, 2)], agora);
    expect(d.enviar).toEqual([]);
    expect(d.agendadas.map((o) => o.sgpOsId)).toEqual(["1"]);
  });

  it("respeita o intervalo entre envios", () => {
    expect(decidir([os("1")], [oferta("1", 1, 23)], agora).enviar).toEqual([]);
    expect(decidir([os("1")], [oferta("1", 1, INTERVALO_MS / 3_600_000)], agora).enviar).toHaveLength(1);
  });

  it("no teto, so desiste depois do intervalo do ultimo envio", () => {
    expect(decidir([os("1")], [oferta("1", MAX_TENTATIVAS, 5)], agora)).toEqual({ enviar: [], semRetorno: [], agendadas: [] });
    const d = decidir([os("1")], [oferta("1", MAX_TENTATIVAS, 25)], agora);
    expect(d.enviar).toEqual([]);
    expect(d.semRetorno.map((o) => o.sgpOsId)).toEqual(["1"]);
  });

  it("sem_retorno e agendada nao voltam a receber", () => {
    const d = decidir([os("1"), os("2")], [oferta("1", 3, 99, "sem_retorno"), oferta("2", 1, 99, "agendada")], agora);
    expect(d).toEqual({ enviar: [], semRetorno: [], agendadas: [] });
  });

  it("para no teto da rodada", () => {
    const muitas = Array.from({ length: MAX_POR_RODADA + 5 }, (_, i) => os(String(i)));
    expect(decidir(muitas, [], agora).enviar).toHaveLength(MAX_POR_RODADA);
  });
});

describe("dentroDaJanela (hora de Brasilia)", () => {
  it.each([
    ["2026-11-03T09:59:00Z", false], // 06h59
    ["2026-11-03T10:00:00Z", true], // 07h
    ["2026-11-03T22:59:00Z", true], // 19h59
    ["2026-11-03T23:00:00Z", false], // 20h
    ["2026-11-04T02:00:00Z", false], // 23h
  ])("%s -> %s", (iso, esperado) => {
    expect(dentroDaJanela(new Date(iso))).toBe(esperado);
  });
});
