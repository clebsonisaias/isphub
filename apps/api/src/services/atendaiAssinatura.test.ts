import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinaturaConfere } from "./atendaiAssinatura.js";

const SEGREDO = "seg_do_webhook";
const CORPO = JSON.stringify({ evento: "chat_nova_mensagem", conversaId: "c1" });
const assinar = (corpo: string, seg = SEGREDO) =>
  `sha256=${createHmac("sha256", seg).update(corpo, "utf8").digest("hex")}`;

describe("assinaturaConfere", () => {
  it("aceita a assinatura correta", () => {
    expect(assinaturaConfere(CORPO, assinar(CORPO), SEGREDO)).toBe(true);
  });

  it("aceita sem o prefixo sha256=", () => {
    const hex = assinar(CORPO).slice(7);
    expect(assinaturaConfere(CORPO, hex, SEGREDO)).toBe(true);
  });

  it("recusa corpo adulterado", () => {
    // O ataque que isto barra: mesma assinatura, mensagem trocada.
    expect(assinaturaConfere(CORPO + " ", assinar(CORPO), SEGREDO)).toBe(false);
  });

  it("recusa segredo errado", () => {
    expect(assinaturaConfere(CORPO, assinar(CORPO, "outro"), SEGREDO)).toBe(false);
  });

  it("SEM segredo cadastrado recusa — 'ainda nao configurei' nao pode virar porta aberta", () => {
    expect(assinaturaConfere(CORPO, assinar(CORPO), null)).toBe(false);
  });

  it("sem cabecalho recusa", () => {
    expect(assinaturaConfere(CORPO, undefined, SEGREDO)).toBe(false);
  });

  it("assinatura de tamanho diferente RECUSA em vez de lancar", () => {
    // timingSafeEqual lanca com buffers de tamanhos diferentes, e um throw aqui
    // viraria 500 no webhook em vez de 401.
    expect(() => assinaturaConfere(CORPO, "sha256=abcd", SEGREDO)).not.toThrow();
    expect(assinaturaConfere(CORPO, "sha256=abcd", SEGREDO)).toBe(false);
  });

  it("lixo nao-hex recusa sem lancar", () => {
    expect(() => assinaturaConfere(CORPO, "sha256=zzzz", SEGREDO)).not.toThrow();
    expect(assinaturaConfere(CORPO, "sha256=zzzz", SEGREDO)).toBe(false);
  });
});
