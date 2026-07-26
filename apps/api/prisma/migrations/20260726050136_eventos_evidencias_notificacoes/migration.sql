-- Fundacao pra timeline de OS (os_eventos), evidencias fotograficas
-- local-only (evidencias, bytea, sem storage externo) e notificacoes in-app.
-- Migracao puramente aditiva: nenhuma coluna/tabela existente e alterada ou
-- removida, sem backfill necessario.

-- CreateEnum
CREATE TYPE "OsEventoTipo" AS ENUM ('atribuicao', 'status', 'anotacao', 'foto');

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "slaNotificadoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "evidencias" (
    "id" TEXT NOT NULL,
    "ordemServicoId" TEXT NOT NULL,
    "autorId" TEXT,
    "legenda" TEXT,
    "mimeType" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "dados" BYTEA NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_eventos" (
    "id" TEXT NOT NULL,
    "ordemServicoId" TEXT NOT NULL,
    "tipo" "OsEventoTipo" NOT NULL,
    "autorId" TEXT,
    "descricao" TEXT NOT NULL,
    "evidenciaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "os_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "ordemServicoId" TEXT,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidencias_ordemServicoId_idx" ON "evidencias"("ordemServicoId");

-- CreateIndex
CREATE INDEX "os_eventos_ordemServicoId_criadoEm_idx" ON "os_eventos"("ordemServicoId", "criadoEm");

-- CreateIndex
CREATE INDEX "notificacoes_usuarioId_lida_criadoEm_idx" ON "notificacoes"("usuarioId", "lida", "criadoEm");

-- AddForeignKey
ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_ordemServicoId_fkey" FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_ordemServicoId_fkey" FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_evidenciaId_fkey" FOREIGN KEY ("evidenciaId") REFERENCES "evidencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_ordemServicoId_fkey" FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
