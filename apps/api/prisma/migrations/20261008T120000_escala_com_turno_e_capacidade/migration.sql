-- Escala com turno e ausencia; capacidade da agenda derivada da escala.
ALTER TABLE "escalas_jornada" ADD COLUMN "turnos" "TurnoAgenda"[] DEFAULT ARRAY['manha', 'tarde']::"TurnoAgenda"[];
ALTER TABLE "escalas_jornada" ADD COLUMN "ausenteEm" TIMESTAMP(3);
ALTER TABLE "escalas_jornada" ADD COLUMN "motivoAusencia" VARCHAR(120);
ALTER TABLE "escalas_jornada" ADD COLUMN "avisosSemJornada" "TurnoAgenda"[] DEFAULT ARRAY[]::"TurnoAgenda"[];

-- Nulo (o padrao) mantem o comportamento atual: so as vagas fixas valem.
ALTER TABLE "agenda_config" ADD COLUMN "vagasPorTecnico" INTEGER;
