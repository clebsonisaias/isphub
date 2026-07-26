-- Marca quando a descricao/conteudo da OS foi editada por acao humana no
-- ISPhub — mesma janela de graca ja usada pra status e observacao, pra
-- edicao nao ser desfeita pelo proximo ciclo de sync.

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "conteudoAlteradoEm" TIMESTAMP(3);
