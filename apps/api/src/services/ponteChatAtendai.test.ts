import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConversaTipo, UserRole } from "@isphub/shared";
import { assinaturaConfere, espelhoDe, nomeNoAtendai, textoParaAtendai, type AvisoChat } from "./ponteChatAtendaiService.js";

describe("assinatura do aviso do AtendAI", () => {
  const segredo = "segredo-de-teste";
  const corpo = Buffer.from('{"evento":"chat_nova_mensagem"}');
  const assinar = (b: Buffer, s = segredo) => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("aceita a assinatura certa dos bytes exatos", () => {
    expect(assinaturaConfere(corpo, assinar(corpo), segredo)).toBe(true);
  });

  it("recusa segredo errado, corpo mexido, sem prefixo e ausente", () => {
    expect(assinaturaConfere(corpo, assinar(corpo, "outro"), segredo)).toBe(false);
    expect(assinaturaConfere(Buffer.from('{"evento":"x"}'), assinar(corpo), segredo)).toBe(false);
    expect(assinaturaConfere(corpo, assinar(corpo).replace("sha256=", ""), segredo)).toBe(false);
    expect(assinaturaConfere(corpo, undefined, segredo)).toBe(false);
  });
});

describe("conversa espelhada", () => {
  const aviso = (o: Partial<AvisoChat> = {}): AvisoChat => ({
    evento: "chat_nova_mensagem",
    conversaId: "c1",
    conversa: { tipo: "DIRETA", titulo: null },
    participantes: [
      { colaboradorId: "x1", nome: "Anna Clara", idExterno: null },
      { colaboradorId: "x2", nome: "Alderi (técnico)", idExterno: "u-alderi" },
    ],
    mensagem: { id: "m1", corpo: "Oi Alderi", autor: { id: "x1", nome: "Anna Clara" } },
    ...o,
  });

  it("direta: o título é o nome de quem está no AtendAI", () => {
    expect(espelhoDe(aviso())).toEqual({ tipo: ConversaTipo.DIRETA, titulo: "Anna Clara (AtendAI)" });
  });

  it("grupo: o título de lá, ou os nomes de lá", () => {
    expect(espelhoDe(aviso({ conversa: { tipo: "GRUPO", titulo: "Suporte NetGo" } }))).toEqual({ tipo: ConversaTipo.GRUPO, titulo: "Suporte NetGo" });
    expect(espelhoDe(aviso({ conversa: { tipo: "GRUPO", titulo: null } })).titulo).toBe("Anna Clara (AtendAI)");
  });
});

describe("o que vai para o AtendAI", () => {
  it("texto vai como está; foto, áudio e localização viram uma linha dizendo o que foi enviado", () => {
    expect(textoParaAtendai({ tipo: "texto", corpo: " Chego em 20 min " })).toBe("Chego em 20 min");
    expect(textoParaAtendai({ tipo: "foto", corpo: null })).toBe("[Foto enviada no ISPhub]");
    expect(textoParaAtendai({ tipo: "foto", corpo: "poste caído" })).toBe("[Foto enviada no ISPhub] poste caído");
    expect(textoParaAtendai({ tipo: "audio" })).toBe("[Áudio enviado no ISPhub]");
    expect(textoParaAtendai({ tipo: "localizacao", lat: -5.86, lng: -35.35 })).toBe("Localização: https://maps.google.com/?q=-5.86,-35.35");
  });

  it("texto vazio e mensagem de sistema não vão", () => {
    expect(textoParaAtendai({ tipo: "texto", corpo: "  " })).toBeNull();
    expect(textoParaAtendai({ tipo: "sistema", corpo: "Fulano assumiu" })).toBeNull();
  });

  it("a pessoa daqui aparece com a função", () => {
    expect(nomeNoAtendai({ nome: "Alderi", role: UserRole.TECNICO })).toBe("Alderi (técnico)");
    expect(nomeNoAtendai({ nome: "Darios", role: UserRole.GESTOR })).toBe("Darios (supervisor)");
  });
});
