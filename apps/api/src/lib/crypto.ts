import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Criptografia AES-256-GCM para os tokens de ERP (SGP) em repouso.
 *
 * O token do SGP e uma credencial sensivel — da mesma familia de dado que o
 * Maxxi guarda em texto puro nos docs (heads-up sinalizado no plano). Aqui
 * ele nunca toca o disco em claro: é cifrado antes do INSERT/UPDATE e
 * decifrado apenas em memoria, no momento de chamar o SGP.
 *
 * Formato armazenado: "<iv_base64>:<authTag_base64>:<ciphertext_base64>".
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM

function getKey(): Buffer {
  return Buffer.from(env.CRYPTO_KEY, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Payload cifrado em formato invalido");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Mascara um token para exibicao segura no front (ex.: "3a4e****aad0"). */
export function maskToken(token: string): string {
  if (token.length <= 8) return "*".repeat(token.length);
  return `${token.slice(0, 4)}${"*".repeat(4)}${token.slice(-4)}`;
}
