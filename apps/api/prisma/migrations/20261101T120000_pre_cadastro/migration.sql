-- Vendedor em campo: papel novo e o rastro do pre-cadastro.
ALTER TYPE "UserRole" ADD VALUE 'vendedor';

CREATE TABLE "pre_cadastros" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "clienteNome" TEXT NOT NULL,
    "celular" TEXT,
    "cidade" TEXT,
    "bairro" TEXT,
    "plano" TEXT,
    "vencimentoDia" INTEGER,
    "contratoId" TEXT,
    "protocolo" TEXT,
    "sgpOsId" TEXT,
    "regiao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enviado',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pre_cadastros_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pre_cadastros_provedorId_criadoEm_idx" ON "pre_cadastros"("provedorId", "criadoEm");
CREATE INDEX "pre_cadastros_vendedorId_criadoEm_idx" ON "pre_cadastros"("vendedorId", "criadoEm");
ALTER TABLE "pre_cadastros" ADD CONSTRAINT "pre_cadastros_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pre_cadastros" ADD CONSTRAINT "pre_cadastros_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
