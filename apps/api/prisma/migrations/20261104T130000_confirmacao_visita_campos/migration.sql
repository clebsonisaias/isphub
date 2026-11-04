-- AlterTable
ALTER TABLE "agendamentos" ADD COLUMN IF NOT EXISTS "solicitouReagendamento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agendamentos" ADD COLUMN IF NOT EXISTS "lembreteEnviadoEm" TIMESTAMP(3);
