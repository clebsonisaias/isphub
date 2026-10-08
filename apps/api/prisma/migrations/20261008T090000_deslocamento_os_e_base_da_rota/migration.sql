-- Origem da rota sugerida (de onde a equipe sai de manha). Nulavel: sem ela,
-- a primeira parada vira origem.
ALTER TABLE "agenda_config" ADD COLUMN "baseLat" DOUBLE PRECISION;
ALTER TABLE "agenda_config" ADD COLUMN "baseLng" DOUBLE PRECISION;

-- Quanto a viatura rodou ATE uma OS. Derivado e recalculavel: tabela propria,
-- nao coluna no espelho da OS.
CREATE TABLE "deslocamentos_os" (
    "id" TEXT NOT NULL,
    "ordemServicoId" TEXT NOT NULL,
    "veiculoId" TEXT,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "metros" INTEGER NOT NULL,
    "pontos" INTEGER NOT NULL,
    "fonte" TEXT NOT NULL,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deslocamentos_os_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deslocamentos_os_ordemServicoId_key" ON "deslocamentos_os"("ordemServicoId");
CREATE INDEX "deslocamentos_os_veiculoId_inicioEm_idx" ON "deslocamentos_os"("veiculoId", "inicioEm");

ALTER TABLE "deslocamentos_os" ADD CONSTRAINT "deslocamentos_os_ordemServicoId_fkey"
    FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deslocamentos_os" ADD CONSTRAINT "deslocamentos_os_veiculoId_fkey"
    FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
