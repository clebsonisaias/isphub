-- CreateEnum
CREATE TYPE "ClassificacaoDre" AS ENUM ('deducao', 'custo_variavel', 'despesa_operacional');

-- AlterTable
ALTER TABLE "categorias_financeiras" ADD COLUMN     "classificacao" "ClassificacaoDre";

