import "dotenv/config";
import { z } from "zod";

/**
 * Flag booleana vinda do ambiente. `process.env.X` e sempre string, e toda
 * string nao-vazia e truthy em JS — entao `if (process.env.FLAG)` LIGA a flag
 * mesmo com o valor "false", que e exatamente como o dump de payload bruto do
 * SGP (com PII de cliente) ficou ligado em producao apesar de
 * SGP_DEBUG_RAW=false. So "true"/"1" (sem diferenciar maiuscula) ativam.
 */
const flagBooleana = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase() === "true" || v?.trim() === "1");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL e obrigatorio"),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(16, "JWT_SECRET deve ter pelo menos 16 caracteres"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CRYPTO_KEY: z
    .string()
    .length(64, "CRYPTO_KEY deve ser uma string hex de 64 caracteres (32 bytes)"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * Loga o payload bruto do SGP (util pra descobrir nomes de campo reais).
   * Contem PII de cliente (nome, CPF/CNPJ, endereco) — manter desligado fora
   * de uma investigacao pontual.
   */
  SGP_DEBUG_RAW: flagBooleana,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuracao de ambiente invalida:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Falha ao carregar variaveis de ambiente. Veja .env.example.");
}

export const env = parsed.data;
