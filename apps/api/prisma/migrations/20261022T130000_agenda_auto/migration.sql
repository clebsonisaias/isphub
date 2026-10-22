-- Agendador automatico: chave geral, teto por rodada e reserva de urgencia.
-- Aditiva: os padroes (desligado, 20, 0) mantem o comportamento de hoje.
ALTER TABLE "agenda_config" ADD COLUMN "autoAgendaAtiva" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agenda_config" ADD COLUMN "autoAgendaMaxRodada" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "agenda_config" ADD COLUMN "vagasUrgenciaDia" INTEGER NOT NULL DEFAULT 0;
