-- AlterTable
-- IF NOT EXISTS: a primeira tentativa em producao (01/11/2026) falhou e travou a
-- subida da API; repetir esta migracao tem que ser seguro.
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "avaliacaoNota" INTEGER;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "avaliacaoComentario" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "avaliacaoEm" TIMESTAMP(3);
