-- AlterTable
ALTER TABLE "lancamentos" ADD COLUMN     "numeroParcela" INTEGER,
ADD COLUMN     "parcelamentoId" TEXT;

-- CreateTable
CREATE TABLE "parcelamentos" (
    "id" TEXT NOT NULL,
    "tipo" "LancamentoTipo" NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "valorTotal" DECIMAL(14,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "primeiroVencimento" DATE NOT NULL,
    "provedorId" TEXT,
    "categoriaId" TEXT,
    "observacao" VARCHAR(500),
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcelamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_parcelamentoId_numeroParcela_key" ON "lancamentos"("parcelamentoId", "numeroParcela");

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_parcelamentoId_fkey" FOREIGN KEY ("parcelamentoId") REFERENCES "parcelamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

