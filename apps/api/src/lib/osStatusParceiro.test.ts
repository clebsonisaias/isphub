import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { montarOsStatus, primeiroNome } from "./osStatusParceiro.js";

const inicio = (dia: string) => new Date(`${dia}T11:00:00.000Z`);
const base = { status: "em_deslocamento", tecnicoSgpNome: null };

describe("GET /agenda/os/:sgpOsId — contrato", () => {
  it("devolve só o primeiro nome do técnico", () => {
    const r = montarOsStatus(
      { ...base, tecnico: { nome: "  Carlos Alberto da Silva " }, agendamento: null },
      inicio,
    );
    expect(r.tecnicoPrimeiroNome).toBe("Carlos");
    expect(JSON.stringify(r)).not.toMatch(/Silva|Alberto/);
  });

  it("cai no nome do SGP quando não há técnico do ISPhub; null sem nenhum", () => {
    expect(montarOsStatus({ ...base, tecnico: null, tecnicoSgpNome: "Maria Souza", agendamento: null }, inicio).tecnicoPrimeiroNome).toBe("Maria");
    expect(primeiroNome("   ")).toBeNull();
    expect(primeiroNome(null)).toBeNull();
  });

  it("expõe dia, turno, início e ordem da rota quando marcado", () => {
    const r = montarOsStatus(
      { ...base, tecnico: null, agendamento: { dia: new Date("2026-10-23"), turno: "manha", status: "marcado", ordemRota: 3 } },
      inicio,
    );
    expect(r).toMatchObject({ status: "em_deslocamento", dia: "2026-10-23", turno: "manha", ordemRota: 3, inicioEm: "2026-10-23T11:00:00.000Z" });
  });

  it("agendamento cancelado não vaza dia/turno", () => {
    const r = montarOsStatus(
      { ...base, tecnico: null, agendamento: { dia: new Date("2026-10-23"), turno: "tarde", status: "cancelado" as never, ordemRota: 1 } },
      inicio,
    );
    expect(r).toMatchObject({ dia: null, turno: null, inicioEm: null, ordemRota: null });
  });
});

describe("rota /os/:sgpOsId — escopo", () => {
  const fonte = readFileSync(fileURLToPath(new URL("../routes/parceiroAgenda.ts", import.meta.url)), "utf8");
  const ini = fonte.indexOf('"/os/:sgpOsId"');
  const handler = fonte.slice(ini, fonte.indexOf("parceiroAgendaRouter.", ini));

  it("escopa pela chave e nunca lê provedor do corpo/query", () => {
    expect(ini).toBeGreaterThan(-1);
    expect(handler).toContain("req.provedorParceiroId!");
    expect(handler).not.toContain("req.body");
    expect(handler).not.toContain("req.query");
    expect(handler).not.toContain("findMany");
  });
});
