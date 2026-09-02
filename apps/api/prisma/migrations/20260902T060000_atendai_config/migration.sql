-- Ligacao de cada provedor com o AtendAI dele. UMA chave por provedor porque
-- do outro lado a chave pertence a um tenant: a OS diz o provedor, o provedor
-- diz a chave, a chave diz o tenant.
CREATE TABLE "atendai_configs" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "chaveCifrada" TEXT NOT NULL,
    "segredoCifrado" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "atendai_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "atendai_configs_provedorId_key" ON "atendai_configs"("provedorId");

ALTER TABLE "atendai_configs" ADD CONSTRAINT "atendai_configs_provedorId_fkey"
    FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
