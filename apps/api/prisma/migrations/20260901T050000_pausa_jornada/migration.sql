-- Pausa dentro da jornada (almoco e afins).
CREATE TYPE "MotivoPausa" AS ENUM ('almoco', 'outro');

CREATE TABLE "pausas_jornada" (
    "id" TEXT NOT NULL,
    "jornadaId" TEXT NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "motivo" "MotivoPausa" NOT NULL DEFAULT 'almoco',
    CONSTRAINT "pausas_jornada_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pausas_jornada_jornadaId_inicioEm_idx" ON "pausas_jornada"("jornadaId", "inicioEm");

ALTER TABLE "pausas_jornada" ADD CONSTRAINT "pausas_jornada_jornadaId_fkey"
    FOREIGN KEY ("jornadaId") REFERENCES "jornadas_tecnico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UMA pausa aberta por jornada. Sem isto, dois toques em "Pausar" abrem duas
-- pausas e o tempo parado e descontado em dobro do tempo trabalhado.
-- Indice parcial nao e expressavel no schema.prisma: ver o aviso no model.
CREATE UNIQUE INDEX "pausas_jornada_uma_aberta"
    ON "pausas_jornada"("jornadaId") WHERE "fimEm" IS NULL;
