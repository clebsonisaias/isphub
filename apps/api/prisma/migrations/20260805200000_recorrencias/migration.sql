-- CreateEnum
CREATE TYPE "FrequenciaRecorrencia" AS ENUM ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual');

-- AlterTable
ALTER TABLE "lancamentos" ADD COLUMN     "recorrenciaId" TEXT;

-- CreateTable
CREATE TABLE "recorrencias" (
    "id" TEXT NOT NULL,
    "tipo" "LancamentoTipo" NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "frequencia" "FrequenciaRecorrencia" NOT NULL DEFAULT 'mensal',
    "diaVencimento" INTEGER NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "provedorId" TEXT,
    "categoriaId" TEXT,
    "observacao" VARCHAR(500),
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recorrencias_ativa_tipo_idx" ON "recorrencias"("ativa", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_recorrenciaId_vencimento_key" ON "lancamentos"("recorrenciaId", "vencimento");

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_recorrenciaId_fkey" FOREIGN KEY ("recorrenciaId") REFERENCES "recorrencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

