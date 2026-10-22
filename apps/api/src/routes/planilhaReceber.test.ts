import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verificarIdTokenGoogle, type ChaveGoogle } from "../lib/googleIdToken.js";
import { tokenConfere } from "./planilhaReceber.js";

describe("segredo do Apps Script", () => {
  const segredo = "a".repeat(40);

  it("aceita so o segredo exato", () => {
    expect(tokenConfere(segredo, segredo)).toBe(true);
    expect(tokenConfere(segredo.slice(1) + "b", segredo)).toBe(false);
    expect(tokenConfere(segredo + "a", segredo)).toBe(false);
    expect(tokenConfere(undefined, segredo)).toBe(false);
    expect(tokenConfere("", segredo)).toBe(false);
  });

  it("segredo nao configurado ou curto demais trava tudo (nunca aceita vazio com vazio)", () => {
    expect(tokenConfere("", "")).toBe(false);
    expect(tokenConfere(undefined, undefined)).toBe(false);
    expect(tokenConfere("curto", "curto")).toBe(false);
  });
});


describe("identidade Google do Apps Script", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chaves: ChaveGoogle[] = [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }];
  const agora = 1_800_000_000_000;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = (claims: Record<string, unknown>, kid = "k1") => {
    const base = `${b64({ alg: "RS256", kid, typ: "JWT" })}.${b64(claims)}`;
    return `${base}.${createSign("RSA-SHA256").update(base).sign(privateKey).toString("base64url")}`;
  };
  const valido = { iss: "https://accounts.google.com", aud: "cliente-x", email: "Clebson@netgo.net.br", email_verified: true, exp: agora / 1000 + 600 };
  const ver = (t: string) => verificarIdTokenGoogle(t, { agora, chaves });

  it("token valido devolve e-mail (minusculo) e aud", async () => {
    expect(await ver(token(valido))).toEqual({ email: "clebson@netgo.net.br", aud: "cliente-x" });
  });

  it("recusa emissor estranho, expirado, e-mail nao verificado e chave desconhecida", async () => {
    expect(await ver(token({ ...valido, iss: "https://evil.example" }))).toBeNull();
    expect(await ver(token({ ...valido, exp: agora / 1000 - 3600 }))).toBeNull();
    expect(await ver(token({ ...valido, email_verified: false }))).toBeNull();
    expect(await ver(token(valido, "outra"))).toBeNull();
  });

  it("recusa token adulterado (troca o e-mail sem reassinar) e lixo", async () => {
    const [cab, , assin] = token(valido).split(".");
    expect(await ver(`${cab}.${b64({ ...valido, email: "outro@netgo.net.br" })}.${assin}`)).toBeNull();
    expect(await ver("nao.e.jwt")).toBeNull();
    expect(await ver("")).toBeNull();
  });
});
