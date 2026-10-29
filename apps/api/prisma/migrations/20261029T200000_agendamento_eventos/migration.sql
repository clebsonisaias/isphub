-- Trilha da agenda e da abertura de OS (aditiva).
ALTER TABLE "agendamentos" ADD COLUMN "osSituacao" TEXT;

CREATE TABLE "agendamento_eventos" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "sgpOsId" TEXT NOT NULL,
    "agendamentoId" TEXT,
    "tipo" TEXT NOT NULL,
    "dia" DATE,
    "turno" "TurnoAgenda",
    "diaAnterior" DATE,
    "turnoAnterior" "TurnoAgenda",
    "origem" TEXT NOT NULL,
    "autor" TEXT,
    "canal" TEXT,
    "protocolo" TEXT,
    "conversaRef" TEXT,
    "osSituacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agendamento_eventos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agendamento_eventos_provedorId_sgpOsId_criadoEm_idx" ON "agendamento_eventos"("provedorId", "sgpOsId", "criadoEm");

ALTER TABLE "agendamento_eventos" ADD CONSTRAINT "agendamento_eventos_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
