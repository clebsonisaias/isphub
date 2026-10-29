import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { descreverEventoAgenda, montarTimeline, resumoMarcacao, rotuloJanela, type EventoAgenda } from "./eventosAgenda.js";
import { tipoDaMarcacao } from "../services/agendaService.js";

const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
const ev = (o: Partial<EventoAgenda>): EventoAgenda => ({ id: "e1", tipo: "marcado", origem: "atendai_ia", criadoEm: new Date("2026-10-29T19:32:00Z"), ...o });

describe("textos da trilha da agenda", () => {
  it("janela legível a partir do DATE da agenda", () => {
    expect(rotuloJanela(dia("2026-10-30"), "manha")).toBe("sex 30/10, manhã");
    expect(rotuloJanela(null, null)).toBe("data não informada");
  });

  it("IA marcou numa OS que já estava aberta, com canal e protocolo", () => {
    const t = descreverEventoAgenda(ev({ dia: dia("2026-10-30"), turno: "manha", osSituacao: "ja_aberta", canal: "WhatsApp", protocolo: "261029-A0373A" }));
    expect(t).toBe("Visita marcada para sex 30/10, manhã pela IA do AtendAI · a OS já estava aberta · WhatsApp · protocolo 261029-A0373A");
  });

  it("abertura pela IA, remarcação com o antes e o depois, desmarcação e confirmação", () => {
    expect(descreverEventoAgenda(ev({ tipo: "os_aberta", protocolo: "P1" }))).toBe("OS aberta pela IA do AtendAI · protocolo P1");
    expect(
      descreverEventoAgenda(ev({ tipo: "remarcado", origem: "isphub", autor: "ana@isphub", dia: dia("2026-10-30"), turno: "manha", diaAnterior: dia("2026-10-29"), turnoAnterior: "tarde" })),
    ).toBe("Visita remarcada de qui 29/10, tarde para sex 30/10, manhã por ana@isphub");
    expect(descreverEventoAgenda(ev({ tipo: "desmarcado", origem: "atendai_humano", autor: "Jorge", dia: dia("2026-10-30"), turno: "tarde" }))).toBe(
      "Visita de sex 30/10, tarde desmarcada por Jorge (AtendAI)",
    );
    expect(descreverEventoAgenda(ev({ tipo: "confirmado", origem: "cliente", dia: dia("2026-10-30"), turno: "manha" }))).toBe("Cliente confirmou a visita de sex 30/10, manhã");
  });
});

describe("montarTimeline", () => {
  const daOs = [{ id: "o1", tipo: "status" as const, autorNome: "Carlos", descricao: "Em deslocamento", criadoEm: "2026-10-30T11:00:00.000Z" }];
  const os = { usuario: "system", dataCadastro: new Date("2026-10-29T19:09:00Z") };

  it("junta eventos da OS, trilha da agenda e a abertura do SGP, do mais novo para o mais velho", () => {
    const t = montarTimeline(daOs, [ev({ dia: dia("2026-10-30"), turno: "manha" })], os);
    expect(t.map((x) => x.tipo)).toEqual(["status", "agenda", "abertura"]);
    expect(t[2]).toMatchObject({ descricao: "OS aberta no SGP", autorNome: "system" });
    expect(t[1]!.autorNome).toBe("IA do AtendAI");
  });

  it("aviso de abertura do AtendAI substitui a linha do espelho (os dois contariam a mesma coisa)", () => {
    const t = montarTimeline([], [ev({ tipo: "os_aberta", criadoEm: new Date("2026-10-29T19:09:00Z") })], os);
    expect(t.filter((x) => x.tipo === "abertura")).toHaveLength(1);
    expect(t[0]!.descricao).toMatch(/pela IA do AtendAI/);
  });

  it("sem data de cadastro e sem trilha, fica só o que a OS tinha", () => {
    expect(montarTimeline(daOs, [], { usuario: null, dataCadastro: null })).toHaveLength(1);
  });
});

describe("resumoMarcacao (linha do detalhe)", () => {
  it("diz quem marcou, quando e se a OS já estava aberta; nada sem visita marcada", () => {
    const base = { status: "marcado", origem: "atendai_ia", marcadoPor: "CláudIA", osSituacao: "ja_aberta", atualizadoEm: new Date("2026-10-29T19:32:00Z") };
    expect(resumoMarcacao(base)).toBe("Marcada pela IA do AtendAI em qui 29/10 · 16:32 · a OS já estava aberta");
    expect(resumoMarcacao({ ...base, status: "cancelado" })).toBeNull();
    expect(resumoMarcacao(null)).toBeNull();
  });
});

describe("tipoDaMarcacao", () => {
  it("primeira marcação ou depois de desmarcar = marcado; outra janela = remarcado; mesma janela = nada", () => {
    expect(tipoDaMarcacao(null, "2026-10-30", "manha")).toBe("marcado");
    expect(tipoDaMarcacao({ dia: dia("2026-10-30"), turno: "manha", status: "cancelado" }, "2026-10-30", "manha")).toBe("marcado");
    expect(tipoDaMarcacao({ dia: dia("2026-10-29"), turno: "tarde", status: "marcado" }, "2026-10-30", "manha")).toBe("remarcado");
    expect(tipoDaMarcacao({ dia: dia("2026-10-30"), turno: "manha", status: "marcado" }, "2026-10-30", "manha")).toBeNull();
  });
});

describe("rota de parceiro: aviso de abertura", () => {
  const fonte = readFileSync(fileURLToPath(new URL("../routes/parceiroAgenda.ts", import.meta.url)), "utf8");
  it("o escopo vem da chave, nunca do corpo", () => {
    const bloco = fonte.slice(fonte.indexOf('"/os/aberta"'));
    expect(bloco).toContain("provedorId: req.provedorParceiroId!");
    expect(bloco).not.toMatch(/b\.provedorId|req\.body\.provedorId/);
  });
});
