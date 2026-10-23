-- Papel "atendente": marca visitas do proprio provedor, mais nada (ver middleware/auth.ts).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'atendente';

-- A mesma tabela guarda os atendentes do SGP (quem registra OS), separados por papel.
ALTER TABLE "tecnicos_sgp" ADD COLUMN "papel" TEXT NOT NULL DEFAULT 'tecnico';
DROP INDEX "tecnicos_sgp_provedorId_sgpId_key";
CREATE UNIQUE INDEX "tecnicos_sgp_provedorId_papel_sgpId_key" ON "tecnicos_sgp"("provedorId", "papel", "sgpId");
