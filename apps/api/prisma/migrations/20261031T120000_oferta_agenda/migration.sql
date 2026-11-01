-- Robo de agendamento: tipo de OS agendavel, chave por provedor e estado da oferta.
ALTER TABLE "tipos_os" ADD COLUMN "agendavel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "atendai_configs" ADD COLUMN "ofertaAgendaAtiva" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ofertas_agenda" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "sgpOsId" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimaEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'enviada',
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ofertas_agenda_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ofertas_agenda_provedorId_sgpOsId_key" ON "ofertas_agenda"("provedorId", "sgpOsId");
CREATE INDEX "ofertas_agenda_status_idx" ON "ofertas_agenda"("status");
ALTER TABLE "ofertas_agenda" ADD CONSTRAINT "ofertas_agenda_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
