-- Tecnicos do SGP vinculados aos tecnicos do ISPhub, e a funcao (tecnico/auxiliar).
ALTER TABLE "usuarios" ADD COLUMN "funcaoCampo" TEXT;

CREATE TABLE "tecnicos_sgp" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "sgpId" TEXT NOT NULL,
    "nome" TEXT,
    "username" TEXT,
    "usuarioId" TEXT,
    "ignorado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tecnicos_sgp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tecnicos_sgp_provedorId_sgpId_key" ON "tecnicos_sgp"("provedorId", "sgpId");
CREATE INDEX "tecnicos_sgp_usuarioId_idx" ON "tecnicos_sgp"("usuarioId");
ALTER TABLE "tecnicos_sgp" ADD CONSTRAINT "tecnicos_sgp_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tecnicos_sgp" ADD CONSTRAINT "tecnicos_sgp_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
