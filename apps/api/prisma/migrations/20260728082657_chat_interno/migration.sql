-- Chat interno de operacao: DM, grupo, thread por OS (1 por OS, ver o
-- @unique em conversas.ordemServicoId) e canal de Avisos. Soft delete em
-- mensagens (apagadoEm) — nada some do banco. Aditiva, sem risco pra dado
-- existente (unica alteracao em tabela existente e a coluna nullable
-- usuarios.ultimaAtividadeEm).

-- CreateEnum
CREATE TYPE "ConversaTipo" AS ENUM ('direta', 'grupo', 'os', 'avisos');

-- CreateEnum
CREATE TYPE "MensagemTipo" AS ENUM ('texto', 'foto', 'audio', 'localizacao', 'os_ref', 'sistema');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "ultimaAtividadeEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "tipo" "ConversaTipo" NOT NULL,
    "titulo" TEXT,
    "ordemServicoId" TEXT,
    "criadoPorId" TEXT,
    "ultimaMensagemEm" TIMESTAMP(3),
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversa_participantes" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "ultimaLeituraEm" TIMESTAMP(3),
    "silenciado" BOOLEAN NOT NULL DEFAULT false,
    "saiuEm" TIMESTAMP(3),

    CONSTRAINT "conversa_participantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "autorId" TEXT,
    "tipo" "MensagemTipo" NOT NULL,
    "corpo" TEXT,
    "anexoDados" BYTEA,
    "anexoMime" TEXT,
    "anexoTamanho" INTEGER,
    "duracaoSeg" INTEGER,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "ordemServicoId" TEXT,
    "respondendoAId" TEXT,
    "editadoEm" TIMESTAMP(3),
    "apagadoEm" TIMESTAMP(3),
    "apagadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_reacoes" (
    "id" TEXT NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagem_reacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversas_ordemServicoId_key" ON "conversas"("ordemServicoId");

-- CreateIndex
CREATE INDEX "conversas_tipo_ultimaMensagemEm_idx" ON "conversas"("tipo", "ultimaMensagemEm");

-- CreateIndex
CREATE INDEX "conversa_participantes_usuarioId_conversaId_idx" ON "conversa_participantes"("usuarioId", "conversaId");

-- CreateIndex
CREATE UNIQUE INDEX "conversa_participantes_conversaId_usuarioId_key" ON "conversa_participantes"("conversaId", "usuarioId");

-- CreateIndex
CREATE INDEX "mensagens_conversaId_criadoEm_idx" ON "mensagens"("conversaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_reacoes_mensagemId_usuarioId_emoji_key" ON "mensagem_reacoes"("mensagemId", "usuarioId", "emoji");

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_ordemServicoId_fkey" FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_participantes" ADD CONSTRAINT "conversa_participantes_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_participantes" ADD CONSTRAINT "conversa_participantes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_respondendoAId_fkey" FOREIGN KEY ("respondendoAId") REFERENCES "mensagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_reacoes" ADD CONSTRAINT "mensagem_reacoes_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_reacoes" ADD CONSTRAINT "mensagem_reacoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
