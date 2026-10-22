-- Fila de retirada: fatia do teto diario (vagasDia), separada de instalacao/reparo.
-- Aditiva: o padrao 'normal' mantem tudo o que ja existe como esta.
ALTER TABLE "agendamentos" ADD COLUMN "fila" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "agenda_config" ADD COLUMN "vagasRetiradaDia" INTEGER NOT NULL DEFAULT 0;
