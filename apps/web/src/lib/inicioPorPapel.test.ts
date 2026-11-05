import { describe, expect, it } from "vitest";
import { UserRole, podeRotaWeb } from "@isphub/shared";
import { destinoDoLogin, fixosRodapeDoPapel, inicioDoPapel, ordenarPorPapel } from "./inicioPorPapel";

describe("cada papel começa no seu trabalho", () => {
  it("gestor e admin no Despacho, atendente em Marcar visita, técnico e provedor no Painel", () => {
    expect(inicioDoPapel(UserRole.GESTOR)).toBe("/despacho");
    expect(inicioDoPapel(UserRole.ADMIN)).toBe("/despacho");
    expect(inicioDoPapel(UserRole.ATENDENTE)).toBe("/marcar-visita");
    expect(inicioDoPapel(UserRole.TECNICO)).toBe("/");
    expect(inicioDoPapel(UserRole.PROVEDOR)).toBe("/");
  });

  it("depois do login: volta para a página pedida; se era a raiz (ou nenhuma), vai para a tela do papel", () => {
    expect(destinoDoLogin(UserRole.ATENDENTE, undefined)).toBe("/marcar-visita");
    expect(destinoDoLogin(UserRole.GESTOR, "/")).toBe("/despacho");
    expect(destinoDoLogin(UserRole.GESTOR, "/frota")).toBe("/frota");
  });
});

describe("supervisor com áreas definidas", () => {
  it("sem permissões (null) é o gestor de sempre: Despacho", () => {
    expect(inicioDoPapel(UserRole.GESTOR, null)).toBe("/despacho");
    expect(inicioDoPapel(UserRole.GESTOR, undefined)).toBe("/despacho");
  });

  it("sem Despacho: a primeira tela permitida na ordem do menu", () => {
    expect(inicioDoPapel(UserRole.GESTOR, { fila: "ver", agenda: "editar" })).toBe("/");
    expect(inicioDoPapel(UserRole.GESTOR, { agenda: "ver" })).toBe("/marcar-visita");
    expect(inicioDoPapel(UserRole.GESTOR, { frota: "editar", indicadores: "ver" })).toBe("/frota");
    expect(inicioDoPapel(UserRole.GESTOR, { preCadastro: "editar" })).toBe("/pre-cadastro");
    expect(inicioDoPapel(UserRole.GESTOR, { equipe: "ver" })).toBe("/equipe");
  });

  it("nenhuma área: o perfil, que é livre", () => {
    expect(inicioDoPapel(UserRole.GESTOR, {})).toBe("/perfil");
  });

  it("as permissões só valem para o gestor", () => {
    expect(inicioDoPapel(UserRole.ADMIN, {})).toBe("/despacho");
    expect(inicioDoPapel(UserRole.ATENDENTE, {})).toBe("/marcar-visita");
  });

  it("login pela raiz leva à primeira tela permitida", () => {
    expect(destinoDoLogin(UserRole.GESTOR, "/", { fila: "ver" })).toBe("/");
    expect(destinoDoLogin(UserRole.GESTOR, undefined, { escala: "editar" })).toBe("/escala");
  });

  it("a tela inicial calculada sempre passa no podeRotaWeb", () => {
    const casos = [{}, { fila: "ver" }, { chat: "editar" }, { chatClientes: "ver" }, { provisionamento: "editar" }] as const;
    for (const p of casos) expect(podeRotaWeb(p, inicioDoPapel(UserRole.GESTOR, p))).toBe(true);
  });

  it("endereço direto: gestor sem Despacho não abre /despacho; a OS e as subtelas da frota seguem a área", () => {
    const p = { fila: "ver", frota: "ver" } as const;
    expect(podeRotaWeb(p, "/despacho")).toBe(false);
    expect(podeRotaWeb(p, "/os/abc")).toBe(true);
    expect(podeRotaWeb(p, "/frota/bi")).toBe(true);
    expect(podeRotaWeb(p, "/agenda")).toBe(false);
    expect(podeRotaWeb(p, "/perfil")).toBe(true);
    expect(podeRotaWeb(p, "/equipe")).toBe(false);
    expect(podeRotaWeb({ equipe: "ver" }, "/equipe")).toBe(true);
  });
});

describe("ordem do menu", () => {
  const itens = ["/", "/despacho", "/marcar-visita", "/mapa", "/agenda", "/novo"].map((to) => ({ to }));

  it("gestor: Despacho primeiro, depois Painel, Marcar visita, Agenda...; o desconhecido vai pro fim", () => {
    expect(ordenarPorPapel(itens, UserRole.GESTOR).map((i) => i.to)).toEqual(["/despacho", "/", "/marcar-visita", "/agenda", "/mapa", "/novo"]);
  });

  it("atendente: Marcar visita, Agenda, Painel", () => {
    const daAtendente = itens.filter((i) => ["/", "/marcar-visita", "/agenda"].includes(i.to));
    expect(ordenarPorPapel(daAtendente, UserRole.ATENDENTE).map((i) => i.to)).toEqual(["/marcar-visita", "/agenda", "/"]);
  });

  it("técnico e provedor: ordem original", () => {
    expect(ordenarPorPapel(itens, UserRole.TECNICO)).toEqual(itens);
  });

  it("abas do celular: o trabalho do papel primeiro", () => {
    expect(fixosRodapeDoPapel(UserRole.GESTOR)[0]).toBe("/despacho");
    expect(fixosRodapeDoPapel(UserRole.ATENDENTE)[0]).toBe("/marcar-visita");
    expect(fixosRodapeDoPapel(UserRole.TECNICO)[0]).toBe("/");
  });
});
