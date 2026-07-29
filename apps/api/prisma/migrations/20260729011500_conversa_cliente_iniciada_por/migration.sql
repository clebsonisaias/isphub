-- Escopo por papel no chat com clientes: o TECNICO passa a enxergar apenas as
-- conversas que ELE iniciou. `agenteId` nao serve como chave de visibilidade
-- porque muda com assumir/transferir — uma transferencia apagaria a conversa
-- da lista do tecnico que a abriu.

-- CreateEnum
CREATE TYPE "OrigemConversaCliente" AS ENUM ('entrada', 'saida');

-- AlterTable
ALTER TABLE "conversas_clientes" ADD COLUMN     "iniciadaPorId" TEXT,
ADD COLUMN     "origem" "OrigemConversaCliente" NOT NULL DEFAULT 'entrada';

-- AlterTable
ALTER TABLE "mensagens_clientes" ADD COLUMN     "templateNome" TEXT,
ADD COLUMN     "templateVars" JSONB;

-- Backfill: toda conversa existente nasceu do webhook (o disparo por template
-- nao existia ate esta migracao), entao nenhuma tem "quem iniciou". Sem tratar
-- isso, TODO tecnico perderia acesso a TODO o historico no instante do deploy.
-- Criterio: quem ja estava atendendo vira o iniciador — foi quem assumiu a
-- conversa e de fato a conduziu. Conversa sem agente permanece NULL e passa a
-- ser visivel apenas para ADMIN/GESTOR, que despacham via transferir.
UPDATE "conversas_clientes" SET "iniciadaPorId" = "agenteId" WHERE "agenteId" IS NOT NULL;

-- `origem` fica 'entrada' para todas as linhas antigas (default), o que e
-- factualmente correto: todas nasceram de mensagem do cliente.

-- CreateIndex
CREATE INDEX "conversas_clientes_iniciadaPorId_idx" ON "conversas_clientes"("iniciadaPorId");

-- AddForeignKey
ALTER TABLE "conversas_clientes" ADD CONSTRAINT "conversas_clientes_iniciadaPorId_fkey" FOREIGN KEY ("iniciadaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
