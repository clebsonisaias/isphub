-- Chat interno ligado ao do AtendAI: conversa e mensagem espelhadas, e o webhook do provedor.
ALTER TABLE "atendai_configs" ADD COLUMN "chatLigadoEm" TIMESTAMP(3),
ADD COLUMN "chatWebhookId" TEXT;

ALTER TABLE "conversas" ADD COLUMN "atendaiConversaId" TEXT,
ADD COLUMN "provedorId" TEXT;

ALTER TABLE "mensagens" ADD COLUMN "atendaiMensagemId" TEXT,
ADD COLUMN "autorExternoNome" TEXT;

CREATE UNIQUE INDEX "conversas_atendaiConversaId_key" ON "conversas"("atendaiConversaId");
CREATE UNIQUE INDEX "mensagens_atendaiMensagemId_key" ON "mensagens"("atendaiMensagemId");

ALTER TABLE "conversas" ADD CONSTRAINT "conversas_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
