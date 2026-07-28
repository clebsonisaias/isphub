-- Motor de modulos do app do tecnico (Fase 2): estado editavel pelo admin
-- (ativo/ordem/roles). Metadados imutaveis vivem no codigo. Aditiva.
CREATE TABLE IF NOT EXISTS "modulo_configs" (
  "id" TEXT NOT NULL,
  "moduloId" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "rolesPermitidos" TEXT[],
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modulo_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "modulo_configs_moduloId_key" ON "modulo_configs"("moduloId");
