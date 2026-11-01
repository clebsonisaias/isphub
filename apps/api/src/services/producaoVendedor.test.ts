import { describe, expect, it } from "vitest";
import { calcularProducao, diaBr, META_MENSAL, type VendaLinha } from "./producaoVendedorService.js";

// Quarta, 18/11/2026, 10h em Brasilia.
const agora = new Date("2026-11-18T13:00:00Z");
const venda = (vendedorId: string, isoBr: string, status = "enviado"): VendaLinha => ({
  vendedorId,
  // isoBr: "2026-11-18 09:00" no horario de Brasilia
  criadoEm: new Date(`${isoBr.replace(" ", "T")}:00-03:00`),
  status,
});

describe("diaBr", () => {
  it("23h em Brasília ainda é o mesmo dia", () => {
    expect(diaBr(new Date("2026-11-19T01:30:00Z"))).toBe("2026-11-18");
  });
});

describe("calcularProducao", () => {
  it("conta mês, semana e hoje pelo dia de Brasília", () => {
    const p = calcularProducao({
      vendedorId: "ana",
      agora,
      vendas: [
        venda("ana", "2026-10-31 23:30"), // outubro: fora
        venda("ana", "2026-11-03 10:00"),
        venda("ana", "2026-11-16 10:00"), // segunda desta semana
        venda("ana", "2026-11-18 08:00", "agendado"),
        venda("ana", "2026-11-18 09:00"),
      ],
    });
    expect(p.mes).toBe("2026-11");
    expect(p.vendasMes).toBe(4);
    expect(p.vendasSemana).toBe(3);
    expect(p.vendasHoje).toBe(2);
    expect(p.agendadasNaHora).toBe(1);
    expect(p.taxaAgendadaNaHora).toBe(25);
    expect(p.porDia).toHaveLength(18);
    expect(p.porDia[17]).toEqual({ dia: "2026-11-18", vendas: 2 });
  });

  it("sequência: hoje sem venda ainda não quebra; um buraco quebra", () => {
    const p = calcularProducao({
      vendedorId: "ana",
      agora,
      vendas: [venda("ana", "2026-11-14 10:00"), venda("ana", "2026-11-16 10:00"), venda("ana", "2026-11-17 10:00")],
    });
    expect(p.sequenciaDias).toBe(2); // 16 e 17 (15 sem venda quebra; hoje ainda conta como aberto)
  });

  it("nível e meta", () => {
    const vendas = Array.from({ length: 12 }, () => venda("ana", "2026-11-10 10:00"));
    const p = calcularProducao({ vendedorId: "ana", agora, vendas });
    expect(p.nivel).toEqual({ atual: "Prata", proximo: "Ouro", faltamParaProximo: 8 });
    expect(p.faltamParaMeta).toBe(META_MENSAL - 12);
    expect(p.conquistas.find((c) => c.id === "dezena")?.desbloqueada).toBe(true);
    expect(p.conquistas.find((c) => c.id === "dia_cheio")?.desbloqueada).toBe(true);
    expect(p.conquistas.find((c) => c.id === "meta")?.desbloqueada).toBe(false);
  });

  it("ranking privado: posição, total e quanto falta pro líder", () => {
    const p = calcularProducao({
      vendedorId: "ana",
      agora,
      vendas: [
        ...Array.from({ length: 5 }, () => venda("bia", "2026-11-10 10:00")),
        ...Array.from({ length: 3 }, () => venda("ana", "2026-11-10 10:00")),
        venda("caio", "2026-11-10 10:00"),
      ],
    });
    expect(p.ranking).toEqual({ posicao: 2, total: 3, vendasLider: 5, faltamParaLider: 2 });
  });

  it("vendedor sem venda no mês entra no ranking com zero", () => {
    const p = calcularProducao({ vendedorId: "novo", agora, vendas: [venda("bia", "2026-11-10 10:00")] });
    expect(p.vendasMes).toBe(0);
    expect(p.ranking).toEqual({ posicao: 2, total: 2, vendasLider: 1, faltamParaLider: 1 });
    expect(p.nivel.atual).toBe("Bronze");
  });

  it("instaladas e ativas contam só as do vendedor", () => {
    const p = calcularProducao({
      vendedorId: "ana",
      agora,
      vendas: [
        { ...venda("ana", "2026-11-10 10:00"), instalada: true, ativa: true },
        { ...venda("ana", "2026-11-11 10:00"), instalada: true, ativa: false },
        venda("ana", "2026-11-12 10:00"),
        { ...venda("bia", "2026-11-12 10:00"), instalada: true, ativa: true },
      ],
    });
    expect(p.instaladasMes).toBe(2);
    expect(p.ativasMes).toBe(1);
    expect(p.conquistas.find((c) => c.id === "instalada")?.desbloqueada).toBe(true);
  });
});
