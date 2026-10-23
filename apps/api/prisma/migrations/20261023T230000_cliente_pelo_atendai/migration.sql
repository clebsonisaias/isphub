-- Conversa com o cliente da OS pelo canal do AtendAI do provedor.
ALTER TYPE "CanalWhatsapp" ADD VALUE 'atendai';

ALTER TABLE "atendai_configs" ADD COLUMN "canalClientesId" TEXT,
ADD COLUMN "canalClientesNome" TEXT;

ALTER TABLE "conversas_clientes" ADD COLUMN "canalRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN "atendaiConversaId" TEXT,
ADD COLUMN "provedorId" TEXT,
ADD COLUMN "ordemServicoId" TEXT;

DROP INDEX "conversas_clientes_telefone_canal_key";
CREATE UNIQUE INDEX "conversas_clientes_telefone_canal_canalRef_key" ON "conversas_clientes"("telefone", "canal", "canalRef");
CREATE UNIQUE INDEX "conversas_clientes_atendaiConversaId_key" ON "conversas_clientes"("atendaiConversaId");
