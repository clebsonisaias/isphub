-- CreateEnum
CREATE TYPE "CanalWhatsapp" AS ENUM ('meta', 'evolution');

-- CreateEnum
CREATE TYPE "MensagemClienteDirecao" AS ENUM ('entrada', 'saida');

-- CreateEnum
CREATE TYPE "MensagemClienteTipo" AS ENUM ('texto', 'imagem', 'audio', 'documento', 'localizacao', 'sistema');

-- CreateTable
CREATE TABLE "canais_whatsapp_configs" (
    "id" TEXT NOT NULL,
    "tipo" "CanalWhatsapp" NOT NULL,
    "configCifrado" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaVerificacaoEm" TIMESTAMP(3),
    "ultimaVerificacaoOk" BOOLEAN,
    "ultimaVerificacaoMensagem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canais_whatsapp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversas_clientes" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "canal" "CanalWhatsapp" NOT NULL,
    "nomeContato" TEXT,
    "agenteId" TEXT,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "ultimaMensagemEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversas_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_clientes" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "canal" "CanalWhatsapp" NOT NULL,
    "direcao" "MensagemClienteDirecao" NOT NULL,
    "autorId" TEXT,
    "tipo" "MensagemClienteTipo" NOT NULL,
    "corpo" TEXT,
    "anexoDados" BYTEA,
    "anexoMime" TEXT,
    "anexoTamanho" INTEGER,
    "duracaoSeg" INTEGER,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "waMessageId" TEXT NOT NULL,
    "falhaEnvio" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canais_whatsapp_configs_tipo_key" ON "canais_whatsapp_configs"("tipo");

-- CreateIndex
CREATE INDEX "conversas_clientes_canal_arquivada_ultimaMensagemEm_idx" ON "conversas_clientes"("canal", "arquivada", "ultimaMensagemEm");

-- CreateIndex
CREATE INDEX "conversas_clientes_agenteId_idx" ON "conversas_clientes"("agenteId");

-- CreateIndex
CREATE UNIQUE INDEX "conversas_clientes_telefone_canal_key" ON "conversas_clientes"("telefone", "canal");

-- CreateIndex
CREATE INDEX "mensagens_clientes_conversaId_criadoEm_idx" ON "mensagens_clientes"("conversaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_clientes_canal_waMessageId_key" ON "mensagens_clientes"("canal", "waMessageId");

-- AddForeignKey
ALTER TABLE "conversas_clientes" ADD CONSTRAINT "conversas_clientes_agenteId_fkey" FOREIGN KEY ("agenteId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_clientes" ADD CONSTRAINT "mensagens_clientes_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_clientes" ADD CONSTRAINT "mensagens_clientes_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
