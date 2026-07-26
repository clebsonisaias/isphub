-- Marca quando a observacao (eco local da ultima anotacao) foi alterada por
-- acao humana no ISPhub — mesma logica do statusAlteradoEm, so que pro campo
-- observacao, que ate agora nao tinha nenhuma protecao contra ser
-- sobrescrito pelo sync no ciclo seguinte.

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "observacaoAlteradaEm" TIMESTAMP(3);
