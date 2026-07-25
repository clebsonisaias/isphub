import { describe, expect, it } from "vitest";
import { calcularSla } from "./slaService.js";

describe("calcularSla", () => {
  const agora = new Date("2026-07-24T10:00:00.000Z");

  it("retorna sem_sla quando o tipo de OS nao tem slaHoras definido", () => {
    const r = calcularSla({ slaHoras: null, dataBase: agora, agora });
    expect(r.semaforo).toBe("sem_sla");
  });

  it("retorna sem_sla quando nao ha data base (sem agendamento nem criacao)", () => {
    const r = calcularSla({ slaHoras: 4, dataBase: null, agora });
    expect(r.semaforo).toBe("sem_sla");
  });

  it("retorna verde quando falta bem mais que 25% do prazo", () => {
    // SLA de 4h a partir de agora-30min => vence em 3h30, restam 210min (>25% de 240=60min)
    const dataBase = new Date(agora.getTime() - 30 * 60_000);
    const r = calcularSla({ slaHoras: 4, dataBase, agora });
    expect(r.semaforo).toBe("verde");
    expect(r.minutosRestantes).toBe(210);
  });

  it("retorna amarelo dentro dos ultimos 25% do prazo", () => {
    // SLA de 4h (240min); restam 50min (<= 25% de 240 = 60min) => amarelo
    const dataBase = new Date(agora.getTime() - 190 * 60_000);
    const r = calcularSla({ slaHoras: 4, dataBase, agora });
    expect(r.semaforo).toBe("amarelo");
    expect(r.minutosRestantes).toBe(50);
  });

  it("retorna vermelho quando o prazo ja estourou", () => {
    const dataBase = new Date(agora.getTime() - 5 * 60 * 60_000); // 5h atras, SLA de 4h
    const r = calcularSla({ slaHoras: 4, dataBase, agora });
    expect(r.semaforo).toBe("vermelho");
    expect(r.minutosRestantes).toBeLessThan(0);
  });

  it("calcula o vencimentoEm corretamente a partir da dataBase + slaHoras", () => {
    const dataBase = new Date("2026-07-24T08:00:00.000Z");
    const r = calcularSla({ slaHoras: 2, dataBase, agora });
    expect(r.vencimentoEm).toBe("2026-07-24T10:00:00.000Z");
  });
});
