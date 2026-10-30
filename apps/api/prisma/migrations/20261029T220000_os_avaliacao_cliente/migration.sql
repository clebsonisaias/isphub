-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN "avaliacaoNota" INTEGER;
ALTER TABLE "ordens_servico" ADD COLUMN "avaliacaoComentario" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN "avaliacaoEm" TIMESTAMP(3);
