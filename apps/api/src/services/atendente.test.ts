import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import { atendentePode } from "../middleware/auth.js";
import { escopoOsWhere, podeAcessarOs } from "./escopoService.js";
import { decidirDespachoSgp, type DespachoOs } from "./tecnicosSgpService.js";
import type { JwtPayload } from "./authService.js";

describe("atendente: o que alcanca (negacao por padrao)", () => {
  it("fila, OS, agenda (ler, marcar, desmarcar), notificacoes e a propria sessao", () => {
    expect(atendentePode("GET", "/fila?provedorId=x")).toBe(true);
    expect(atendentePode("GET", "/ordens-servico/abc")).toBe(true);
    expect(atendentePode("GET", "/ordens-servico/abc/ficha-sgp")).toBe(true);
    expect(atendentePode("GET", "/agenda/vagas?de=2026-10-23")).toBe(true);
    expect(atendentePode("GET", "/agenda/turno?dia=2026-10-23&turno=manha")).toBe(true);
    expect(atendentePode("POST", "/agenda")).toBe(true);
    expect(atendentePode("DELETE", "/agenda/123")).toBe(true);
    expect(atendentePode("POST", "/auth/login")).toBe(true);
    expect(atendentePode("PATCH", "/notificacoes/1/lida")).toBe(true);
    expect(atendentePode("GET", "/provedores")).toBe(true);
  });

  it("despacho, status, limites, configuracao, usuarios e o resto: fechado", () => {
    expect(atendentePode("POST", "/ordens-servico/abc/atribuir")).toBe(false);
    expect(atendentePode("PATCH", "/ordens-servico/abc/status")).toBe(false);
    expect(atendentePode("GET", "/ordens-servico")).toBe(false);
    expect(atendentePode("PUT", "/admin/agenda")).toBe(false);
    expect(atendentePode("POST", "/agenda/auto/aplicar")).toBe(false);
    expect(atendentePode("PUT", "/agenda/rota")).toBe(false);
    expect(atendentePode("GET", "/usuarios")).toBe(false);
    expect(atendentePode("GET", "/provedores/x/erp-config")).toBe(false);
    expect(atendentePode("GET", "/financeiro")).toBe(false);
    expect(atendentePode("GET", "/dashboard")).toBe(false);
    expect(atendentePode("DELETE", "/agenda/123/extra")).toBe(false);
  });
});

describe("atendente: escopo pelo provedor", () => {
  const atendente = { sub: "u1", role: UserRole.ATENDENTE, provedorId: "netgo" } as JwtPayload;
  it("so as OS do proprio provedor, ignorando o filtro da tela", () => {
    expect(escopoOsWhere(atendente, "citmax")).toEqual({ provedorId: "netgo" });
    expect(podeAcessarOs(atendente, { provedorId: "netgo", tecnicoId: null })).toBe(true);
    expect(podeAcessarOs(atendente, { provedorId: "citmax", tecnicoId: null })).toBe(false);
  });
  it("sem provedor nao vira 'sem filtro'", () => {
    expect(escopoOsWhere({ ...atendente, provedorId: null })).toEqual({ provedorId: "__nenhum__" });
  });
});

describe("despacho do SGP -> ISPhub", () => {
  const ids: Record<string, string> = { alderi: "u-alderi", izarleson: "u-iza", dison: "u-dison" };
  const idDoLogin = (l: string) => ids[l.toLowerCase()];
  const os = (o: Partial<DespachoOs> = {}): DespachoOs => ({
    tecnicoId: null, atribuidoPor: undefined, apoioIds: [], responsavelSgp: "alderi", auxiliaresSgp: ["izarleson"], ...o,
  });

  it("OS sem tecnico: atribui o responsavel e poe o apoio", () => {
    expect(decidirDespachoSgp(os(), idDoLogin)).toEqual({ atribuir: "u-alderi", conflito: false, apoios: ["u-iza"], semVinculo: [] });
  });

  it("ja igual: nada a fazer", () => {
    expect(decidirDespachoSgp(os({ tecnicoId: "u-alderi", apoioIds: ["u-iza"] }), idDoLogin)).toEqual({
      atribuir: null, conflito: false, apoios: null, semVinculo: [],
    });
  });

  it("tecnico posto por gente no ISPhub vence; posto pelo SGP ou pela planilha e trocado", () => {
    expect(decidirDespachoSgp(os({ tecnicoId: "u-dison", atribuidoPor: "user-123" }), idDoLogin)).toMatchObject({ atribuir: null, conflito: true });
    expect(decidirDespachoSgp(os({ tecnicoId: "u-dison", atribuidoPor: "sgp" }), idDoLogin).atribuir).toBe("u-alderi");
    expect(decidirDespachoSgp(os({ tecnicoId: "u-dison", atribuidoPor: "planilha" }), idDoLogin).atribuir).toBe("u-alderi");
  });

  it("login sem vinculo nao atribui e sai na lista; caixa nao importa", () => {
    expect(decidirDespachoSgp(os({ responsavelSgp: "FELIPE", auxiliaresSgp: ["vitor"] }), idDoLogin)).toEqual({
      atribuir: null, conflito: false, apoios: null, semVinculo: ["FELIPE", "vitor"],
    });
    expect(decidirDespachoSgp(os({ responsavelSgp: "Dison", auxiliaresSgp: [] }), idDoLogin).atribuir).toBe("u-dison");
  });

  it("apoio que o SGP tirou sai daqui; o titular nunca e apoio dele mesmo", () => {
    expect(decidirDespachoSgp(os({ tecnicoId: "u-alderi", apoioIds: ["u-iza"], auxiliaresSgp: [] }), idDoLogin).apoios).toEqual([]);
    expect(decidirDespachoSgp(os({ auxiliaresSgp: ["alderi", "izarleson"] }), idDoLogin).apoios).toEqual(["u-iza"]);
  });
});
