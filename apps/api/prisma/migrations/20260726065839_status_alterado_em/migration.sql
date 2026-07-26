-- Marca quando o status de uma OS foi alterado por acao humana no ISPhub
-- (writebackService), nao pelo sync — usado pra sync respeitar uma janela
-- de graca em vez de sobrescrever um status recem-confirmado com o SGP
-- enquanto a leitura do SGP ainda nao reflete a escrita.

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "statusAlteradoEm" TIMESTAMP(3);
