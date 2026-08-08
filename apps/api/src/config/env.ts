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
  /**
   * Origem(ns) do navegador liberadas no CORS. Aceita LISTA separada por
   * virgula: em producao e um valor so, mas em desenvolvimento o painel web
   * (5173) e o app do tecnico rodando no navegador (8081) precisam falar com a
   * MESMA API — e trocar a variavel pra alternar entre eles ja custou uma
   * suite e2e inteira travada em CORS.
   */
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * Loga o payload bruto do SGP (util pra descobrir nomes de campo reais).
   * Contem PII de cliente (nome, CPF/CNPJ, endereco) — manter desligado fora
   * de uma investigacao pontual.
   */
  SGP_DEBUG_RAW: flagBooleana,

  /*
   * SMTP — TODOS opcionais, de proposito.
   *
   * Este schema derruba o processo inteiro quando falta variavel obrigatoria
   * (ver abaixo), e dev, testes e e2e nao tem servidor de e-mail. Marcar SMTP
   * como obrigatorio impediria a API de subir em qualquer ambiente que nao
   * producao — pra entregar um recurso que degrada bem sem ele.
   *
   * Sem SMTP configurado, `emailService` loga o link em vez de enviar. A rota
   * de recuperacao responde igual nos dois casos.
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Remetente ("ISPhub <nao-responda@dominio>"). Cai pro SMTP_USER se faltar. */
  SMTP_FROM: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuracao de ambiente invalida:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Falha ao carregar variaveis de ambiente. Veja .env.example.");
}

export const env = parsed.data;
