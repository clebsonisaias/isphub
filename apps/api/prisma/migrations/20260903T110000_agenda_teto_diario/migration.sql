-- Teto do DIA inteiro, alem do teto de cada turno.
--
-- Nulo (o padrao) mantem o comportamento atual: o limite do dia e a soma dos
-- dois turnos. Aditiva e nulavel — nada muda para quem nao preencher.
ALTER TABLE "agenda_config" ADD COLUMN "vagasDia" INTEGER;
