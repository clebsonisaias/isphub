-- Domingo passa a ter atendimento de manha, com teto proprio (padrao 4).
-- Decisao do usuario em 23/10/2026. A tarde de sabado e domingo segue fechada no codigo.
ALTER TABLE "agenda_config" ADD COLUMN "vagasDomingo" INTEGER DEFAULT 4;
ALTER TABLE "agenda_config" ALTER COLUMN "diasAtendidos" SET DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[];
UPDATE "agenda_config" SET "diasAtendidos" = array_prepend(0, "diasAtendidos") WHERE NOT (0 = ANY("diasAtendidos"));
