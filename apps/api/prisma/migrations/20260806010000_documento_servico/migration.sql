-- AlterTable
ALTER TABLE "lancamentos" ADD COLUMN     "ehServico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "numeroDocumento" VARCHAR(60);

-- CreateIndex
CREATE INDEX "lancamentos_ehServico_idx" ON "lancamentos"("ehServico");

