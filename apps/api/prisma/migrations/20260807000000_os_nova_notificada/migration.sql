-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "novaNotificadaEm" TIMESTAMP(3);

-- O BACKFILL E A PARTE QUE IMPORTA, e o `migrate diff` nao a geraria.
--
-- Sem ele toda OS ja existente ficaria com a coluna nula, e o primeiro tick do
-- job leria "nunca avisada" — despejando MIL notificacoes de OS antigas em cima
-- de cada admin e gestor, de uma vez. Tudo que ja esta aqui, por definicao, nao
-- e novo.
UPDATE "ordens_servico" SET "novaNotificadaEm" = NOW() WHERE "novaNotificadaEm" IS NULL;
