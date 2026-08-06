-- AlterEnum
ALTER TYPE "OsEventoTipo" ADD VALUE 'contrato';

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "contratoStatusAlteradoEm" TIMESTAMP(3);

