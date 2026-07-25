import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL e obrigatorio"),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(16, "JWT_SECRET deve ter pelo menos 16 caracteres"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CRYPTO_KEY: z
    .string()
    .length(64, "CRYPTO_KEY deve ser uma string hex de 64 caracteres (32 bytes)"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuracao de ambiente invalida:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Falha ao carregar variaveis de ambiente. Veja .env.example.");
}

export const env = parsed.data;
