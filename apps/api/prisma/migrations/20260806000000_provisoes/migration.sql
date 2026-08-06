-- CreateEnum
CREATE TYPE "TipoProvisao" AS ENUM ('previsivel', 'folha', 'tributos', 'obrigatorio');

-- AlterTable
ALTER TABLE "recorrencias" ADD COLUMN     "tipoProvisao" "TipoProvisao";

-- CreateIndex
CREATE INDEX "recorrencias_tipoProvisao_idx" ON "recorrencias"("tipoProvisao");

