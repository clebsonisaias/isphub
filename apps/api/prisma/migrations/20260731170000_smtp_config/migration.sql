-- CreateTable
CREATE TABLE "smtp_config" (
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'global',
    "configCifrado" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaVerificacaoEm" TIMESTAMP(3),
    "ultimaVerificacaoOk" BOOLEAN,
    "ultimaVerificacaoMensagem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smtp_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "smtp_config_escopo_key" ON "smtp_config"("escopo");

