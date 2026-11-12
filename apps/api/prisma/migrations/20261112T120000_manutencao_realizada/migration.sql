-- Historico de manutencoes feitas. Aditiva: so cria a tabela e copia a ultima
-- execucao de cada plano, que era tudo o que existia ate aqui.
CREATE TABLE "manutencoes_realizadas" (
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "planoId" TEXT,
    "tipo" VARCHAR(40) NOT NULL,
    "km" INTEGER,
    "em" TIMESTAMP(3) NOT NULL,
    "registradoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manutencoes_realizadas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manutencoes_realizadas_veiculoId_em_idx" ON "manutencoes_realizadas"("veiculoId", "em");

ALTER TABLE "manutencoes_realizadas" ADD CONSTRAINT "manutencoes_realizadas_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manutencoes_realizadas" ADD CONSTRAINT "manutencoes_realizadas_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos_manutencao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O historico antigo: a ultima execucao de cada plano. gen_random_uuid() e
-- nativo do Postgres 13+.
INSERT INTO "manutencoes_realizadas" ("id", "veiculoId", "planoId", "tipo", "km", "em")
SELECT gen_random_uuid()::text, "veiculoId", "id", "tipo", "ultimaKm", "ultimaEm"
FROM "planos_manutencao"
WHERE "ultimaEm" IS NOT NULL;
