-- Fotos de evidencia passam a ser hospedadas no proprio SGP (endpoints reais
-- de imagem descobertos na documentacao oficial), nao mais no Postgres — a
-- tabela "evidencias" (criada na migracao anterior, so com dado de teste)
-- sai. OsEvento.tipo="foto" continua existindo na timeline, so sem FK pra
-- nenhum arquivo local (o arquivo em si mora no SGP).

-- DropForeignKey
ALTER TABLE "evidencias" DROP CONSTRAINT "evidencias_autorId_fkey";

-- DropForeignKey
ALTER TABLE "evidencias" DROP CONSTRAINT "evidencias_ordemServicoId_fkey";

-- DropForeignKey
ALTER TABLE "os_eventos" DROP CONSTRAINT "os_eventos_evidenciaId_fkey";

-- AlterTable
ALTER TABLE "os_eventos" DROP COLUMN "evidenciaId";

-- DropTable
DROP TABLE "evidencias";
