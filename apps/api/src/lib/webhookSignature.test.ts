import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verificarAssinaturaMeta, verificarTokenEvolution } from "./webhookSignature.js";

describe("verificarAssinaturaMeta (HMAC-SHA256 do webhook da Meta)", () => {
  const appSecret = "segredo-do-app-meta";
  const corpo = Buffer.from(JSON.stringify({ entry: [{ id: "1" }] }));

  function assinar(buf: Buffer, secret: string): string {
    return `sha256=${createHmac("sha256", secret).update(buf).digest("hex")}`;
  }

  it("assinatura correta -> aceita", () => {
    const header = assinar(corpo, appSecret);
    expect(verificarAssinaturaMeta(corpo, header, appSecret)).toBe(true);
  });

  it("assinatura de um secret diferente -> rejeita", () => {
    const header = assinar(corpo, "outro-secret-qualquer");
    expect(verificarAssinaturaMeta(corpo, header, appSecret)).toBe(false);
  });

  it("corpo alterado depois de assinado -> rejeita (garante integridade)", () => {
    const header = assinar(corpo, appSecret);
    const corpoAlterado = Buffer.from(JSON.stringify({ entry: [{ id: "2" }] }));
    expect(verificarAssinaturaMeta(corpoAlterado, header, appSecret)).toBe(false);
  });

  it("header ausente -> rejeita", () => {
    expect(verificarAssinaturaMeta(corpo, undefined, appSecret)).toBe(false);
  });

  it("header sem o prefixo sha256= -> rejeita", () => {
    const semPrefixo = createHmac("sha256", appSecret).update(corpo).digest("hex");
    expect(verificarAssinaturaMeta(corpo, semPrefixo, appSecret)).toBe(false);
  });

  it("header com tamanho diferente do esperado -> rejeita sem lancar", () => {
    expect(verificarAssinaturaMeta(corpo, "sha256=abc123", appSecret)).toBe(false);
  });
});

describe("verificarTokenEvolution (token compartilhado do webhook Evolution)", () => {
  it("token igual -> aceita", () => {
    expect(verificarTokenEvolution("chave-secreta-123", "chave-secreta-123")).toBe(true);
  });

  it("token diferente -> rejeita", () => {
    expect(verificarTokenEvolution("chave-errada", "chave-secreta-123")).toBe(false);
  });

  it("header ausente -> rejeita", () => {
    expect(verificarTokenEvolution(undefined, "chave-secreta-123")).toBe(false);
  });

  it("token esperado vazio -> rejeita (nunca aceita tudo por config incompleta)", () => {
    expect(verificarTokenEvolution("qualquer-coisa", "")).toBe(false);
  });
});
