import { describe, expect, it } from "vitest";
import { caminhoNoPainelDoPush, destinoDoPapel, ficaNoPainel, lerMensagemPainel, scriptDeSessao, usaTelasNativas } from "./destino";

describe("destino pelo papel", () => {
  it("técnico fica nas telas nativas; o resto vai para o painel", () => {
    expect(destinoDoPapel("tecnico")).toBe("/minhas-os");
    for (const r of ["admin", "gestor", "atendente", "vendedor", "provedor"]) expect(destinoDoPapel(r)).toBe("/painel");
  });
  it("sem papel ainda (sem /auth/me) não tira o técnico offline do nativo", () => {
    expect(usaTelasNativas(null)).toBe(true);
    expect(usaTelasNativas(undefined)).toBe(true);
  });
});

describe("notificação no painel", () => {
  it("abre a conversa ou a OS certa", () => {
    expect(caminhoNoPainelDoPush({ tela: "chat", conversaId: "c1" })).toBe("/chat?conversa=c1");
    expect(caminhoNoPainelDoPush({ tela: "chat-clientes", conversaId: "c2" })).toBe("/chat-clientes?conversa=c2");
    expect(caminhoNoPainelDoPush({ tela: "os", osId: "o9" })).toBe("/os/o9");
    expect(caminhoNoPainelDoPush({ tela: "chat" })).toBe("/chat");
  });
  it("aviso desconhecido não navega", () => {
    expect(caminhoNoPainelDoPush({ tela: "x" })).toBeNull();
    expect(caminhoNoPainelDoPush(null)).toBeNull();
  });
});

describe("ponte com o painel", () => {
  it("entende saiu e abrir", () => {
    expect(lerMensagemPainel('{"tipo":"saiu"}')).toEqual({ tipo: "saiu" });
    expect(lerMensagemPainel('{"tipo":"abrir","url":"https://maps.google.com/x"}')).toEqual({ tipo: "abrir", url: "https://maps.google.com/x" });
  });
  it("ignora lixo e esquema perigoso", () => {
    expect(lerMensagemPainel("nao é json")).toBeNull();
    expect(lerMensagemPainel('{"tipo":"abrir","url":"javascript:alert(1)"}')).toBeNull();
    expect(lerMensagemPainel('{"tipo":"outra"}')).toBeNull();
  });
  it("o próprio painel fica dentro; o resto abre fora", () => {
    expect(ficaNoPainel("https://painel.isphub.net.br/os/1")).toBe(true);
    expect(ficaNoPainel("about:blank")).toBe(true);
    expect(ficaNoPainel("https://www.google.com/maps")).toBe(false);
  });
});

describe("scriptDeSessao", () => {
  it("marca o modo app e grava a sessão só se a marca mudou", () => {
    const s = scriptDeSessao({ token: "t", refreshToken: "r", marca: "m1" });
    expect(s).toContain("window.ISPHUB_APP = true");
    expect(s).toContain('localStorage.getItem("isphub_app_marca") !== "m1"');
    expect(s).toContain('localStorage.setItem("isphub_refresh", "r")');
    expect(s.trim().endsWith("true;")).toBe(true);
  });
  it("escapa aspas do token (não quebra o script)", () => {
    const s = scriptDeSessao({ token: 'a"b', refreshToken: "r", marca: "m" });
    expect(s).toContain('"a\\"b"');
  });
});
