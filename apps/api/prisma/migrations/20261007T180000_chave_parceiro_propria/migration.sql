-- A chave de parceiro (isk_...) sai de `atendai_configs` e ganha tabela propria:
-- a API de agendamento serve a qualquer sistema do provedor, nao so ao AtendAI,
-- e gerar a chave nao pode exigir o cadastro do AtendAI.
CREATE TABLE "chaves_parceiro" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "rotulo" TEXT,
    "usoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chaves_parceiro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chaves_parceiro_provedorId_key" ON "chaves_parceiro"("provedorId");
CREATE UNIQUE INDEX "chaves_parceiro_prefixo_key" ON "chaves_parceiro"("prefixo");

ALTER TABLE "chaves_parceiro" ADD CONSTRAINT "chaves_parceiro_provedorId_fkey"
    FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Leva as chaves que ja existem: o AtendAI continua entrando com a mesma chave.
INSERT INTO "chaves_parceiro" ("id", "provedorId", "hash", "prefixo", "rotulo", "usoEm")
SELECT gen_random_uuid()::text, "provedorId", "chaveEntradaHash", "chaveEntradaPrefixo", 'AtendAI', "chaveEntradaUsoEm"
FROM "atendai_configs"
WHERE "chaveEntradaHash" IS NOT NULL AND "chaveEntradaPrefixo" IS NOT NULL;

DROP INDEX IF EXISTS "atendai_configs_chaveEntradaPrefixo_key";
ALTER TABLE "atendai_configs"
    DROP COLUMN "chaveEntradaHash",
    DROP COLUMN "chaveEntradaPrefixo",
    DROP COLUMN "chaveEntradaUsoEm";
