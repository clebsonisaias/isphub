-- AlterEnum
ALTER TYPE "EventoRastreadorTipo" ADD VALUE IF NOT EXISTS 'entrou_cerca';
ALTER TYPE "EventoRastreadorTipo" ADD VALUE IF NOT EXISTS 'saiu_cerca';

-- CreateTable
CREATE TABLE IF NOT EXISTS "cercas_virtuais" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT,
    "nome" VARCHAR(80) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL DEFAULT 'circulo',
    "centroLat" DOUBLE PRECISION,
    "centroLng" DOUBLE PRECISION,
    "raioMetros" DOUBLE PRECISION,
    "vertices" JSONB,
    "cor" VARCHAR(16) NOT NULL DEFAULT '#2563eb',
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cercas_virtuais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "estados_cerca_rastreador" (
    "id" TEXT NOT NULL,
    "cercaId" TEXT NOT NULL,
    "rastreadorId" TEXT NOT NULL,
    "dentro" BOOLEAN NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estados_cerca_rastreador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cercas_virtuais_provedorId_ativa_idx" ON "cercas_virtuais"("provedorId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "estados_cerca_rastreador_cercaId_rastreadorId_key" ON "estados_cerca_rastreador"("cercaId", "rastreadorId");

-- AddForeignKey
ALTER TABLE "cercas_virtuais" ADD CONSTRAINT "cercas_virtuais_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estados_cerca_rastreador" ADD CONSTRAINT "estados_cerca_rastreador_cercaId_fkey" FOREIGN KEY ("cercaId") REFERENCES "cercas_virtuais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estados_cerca_rastreador" ADD CONSTRAINT "estados_cerca_rastreador_rastreadorId_fkey" FOREIGN KEY ("rastreadorId") REFERENCES "rastreadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
