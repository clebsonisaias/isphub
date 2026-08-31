import { describe, expect, it } from "vitest";
import type { ModuloHabilitado } from "@isphub/shared";
import { moduloHabilitado } from "./modulos";

const lista: ModuloHabilitado[] = [
  { id: "minhas-os", nome: "Minhas OS", icone: "list", core: true, ordem: 10 },
  { id: "chat", nome: "Chat", icone: "message-circle", core: false, ordem: 45 },
];

describe("moduloHabilitado", () => {
  it("devolve true para modulo presente na lista", () => {
    expect(moduloHabilitado(lista, "chat")).toBe(true);
  });

  it("devolve false para modulo ausente", () => {
    expect(moduloHabilitado(lista, "evidencias")).toBe(false);
  });

  it("devolve true para o core mesmo se a lista vier vazia", () => {
    // A garantia de primeiroNaoVazio (config.tsx) e "nunca ficar sem a fila".
    // O predicado tem de honrar isso sozinho, senao um /config vazio derrubaria
    // a tela principal.
    expect(moduloHabilitado([], "minhas-os")).toBe(true);
  });

  it("nao promove modulo nao-core quando a lista vem vazia", () => {
    expect(moduloHabilitado([], "chat")).toBe(false);
  });
});
