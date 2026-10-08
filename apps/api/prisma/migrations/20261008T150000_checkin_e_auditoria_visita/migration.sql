-- Check-in automatico: raio em metros (0 desliga).
ALTER TABLE "rastreador_configs" ADD COLUMN "checkinRaioMetros" INTEGER NOT NULL DEFAULT 150;

-- Auditoria de presenca: a viatura esteve no endereco da OS concluida?
CREATE TABLE "auditorias_visita" (
    "id" TEXT NOT NULL,
    "ordemServicoId" TEXT NOT NULL,
    "veiculoId" TEXT,
    "veredito" TEXT NOT NULL,
    "distanciaMinMetros" INTEGER,
    "posicoes" INTEGER NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "auditadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificadaEm" TIMESTAMP(3),
    CONSTRAINT "auditorias_visita_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auditorias_visita_ordemServicoId_key" ON "auditorias_visita"("ordemServicoId");
CREATE INDEX "auditorias_visita_veredito_auditadaEm_idx" ON "auditorias_visita"("veredito", "auditadaEm");
ALTER TABLE "auditorias_visita" ADD CONSTRAINT "auditorias_visita_ordemServicoId_fkey"
    FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
