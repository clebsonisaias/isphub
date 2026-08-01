-- CreateTable
CREATE TABLE "sessoes_refresh" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "userAgent" VARCHAR(300),
    "ip" VARCHAR(64),

    CONSTRAINT "sessoes_refresh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_recuperacao_senha" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "tokens_recuperacao_senha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_refresh_tokenHash_key" ON "sessoes_refresh"("tokenHash");

-- CreateIndex
CREATE INDEX "sessoes_refresh_usuarioId_idx" ON "sessoes_refresh"("usuarioId");

-- CreateIndex
CREATE INDEX "sessoes_refresh_expiraEm_idx" ON "sessoes_refresh"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_recuperacao_senha_tokenHash_key" ON "tokens_recuperacao_senha"("tokenHash");

-- CreateIndex
CREATE INDEX "tokens_recuperacao_senha_usuarioId_idx" ON "tokens_recuperacao_senha"("usuarioId");

-- CreateIndex
CREATE INDEX "tokens_recuperacao_senha_expiraEm_idx" ON "tokens_recuperacao_senha"("expiraEm");

-- AddForeignKey
ALTER TABLE "sessoes_refresh" ADD CONSTRAINT "sessoes_refresh_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_recuperacao_senha" ADD CONSTRAINT "tokens_recuperacao_senha_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

