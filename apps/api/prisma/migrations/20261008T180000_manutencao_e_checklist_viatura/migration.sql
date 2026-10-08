-- Manutencao preventiva por km/dias e checklist de viatura (saida/retorno).
CREATE TABLE "planos_manutencao" (
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "intervaloKm" INTEGER,
    "intervaloDias" INTEGER,
    "ultimaKm" INTEGER,
    "ultimaEm" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "avisadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "planos_manutencao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "planos_manutencao_veiculoId_ativo_idx" ON "planos_manutencao"("veiculoId", "ativo");
ALTER TABLE "planos_manutencao" ADD CONSTRAINT "planos_manutencao_veiculoId_fkey"
    FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "checklists_viatura" (
    "id" TEXT NOT NULL,
    "ocupacaoId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "momento" VARCHAR(10) NOT NULL,
    "odometroKm" INTEGER,
    "combustivelPct" INTEGER,
    "avarias" VARCHAR(400),
    "fotoPainel" BYTEA,
    "fotoMime" VARCHAR(40),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checklists_viatura_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checklists_viatura_veiculoId_criadoEm_idx" ON "checklists_viatura"("veiculoId", "criadoEm");
CREATE INDEX "checklists_viatura_ocupacaoId_idx" ON "checklists_viatura"("ocupacaoId");
ALTER TABLE "checklists_viatura" ADD CONSTRAINT "checklists_viatura_veiculoId_fkey"
    FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
