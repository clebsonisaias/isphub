import { describe, expect, it } from "vitest";
import { decrypt, encrypt, maskToken } from "./crypto.js";

describe("crypto (AES-256-GCM para tokens de ERP)", () => {
  it("decifra exatamente o texto que foi cifrado (roundtrip)", () => {
    const original = "3a4e2511-0e0f-4315-b75d-b4b3427aaad0";
    const cifrado = encrypt(original);
    expect(decrypt(cifrado)).toBe(original);
  });

  it("gera cifrados diferentes para o mesmo texto (IV aleatorio)", () => {
    const a = encrypt("mesmo-token");
    const b = encrypt("mesmo-token");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("mesmo-token");
    expect(decrypt(b)).toBe("mesmo-token");
  });

  it("nao armazena o token em claro no payload cifrado", () => {
    const token = "tok-supersecreto-12345";
    const cifrado = encrypt(token);
    expect(cifrado).not.toContain(token);
  });

  it("detecta adulteracao do payload cifrado (auth tag do GCM)", () => {
    const cifrado = encrypt("token-original");
    const partes = cifrado.split(":");
    // corrompe um byte do ciphertext
    const ciphertext = Buffer.from(partes[2], "base64");
    ciphertext[0] ^= 0xff;
    const adulterado = [partes[0], partes[1], ciphertext.toString("base64")].join(":");
    expect(() => decrypt(adulterado)).toThrow();
  });

  it("rejeita payload em formato invalido", () => {
    expect(() => decrypt("nao-e-um-payload-valido")).toThrow(/formato invalido/);
  });
});

describe("maskToken", () => {
  it("mostra so os 4 primeiros e 4 ultimos caracteres", () => {
    expect(maskToken("3a4e2511-0e0f-4315-b75d-b4b3427aaad0")).toBe("3a4e****aad0");
  });

  it("mascara totalmente tokens curtos (<=8 chars)", () => {
    expect(maskToken("abc123")).toBe("******");
  });
});
