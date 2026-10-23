import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
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
