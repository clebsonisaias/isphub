-- Categorias executadas por OUTRA equipe (nao a da ISPhub) — ex.: retirada/
-- cancelamento de equipamento. Aditiva e idempotente: coluna com default,
-- sem reescrever nenhuma linha existente.

ALTER TABLE "categorias" ADD COLUMN IF NOT EXISTS "equipeExterna" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a categoria canonica de retirada (criada em 20260725154818) ja
-- nasce marcada, pra o recurso valer no primeiro boot sem o admin precisar
-- clicar. Se o nome ja tiver sido editado no admin, o UPDATE simplesmente
-- nao acha nada — nao quebra a migracao, so exige um clique em
-- /admin/categorias pra marcar manualmente.
UPDATE "categorias" SET "equipeExterna" = true WHERE "nome" = 'Retirada / Cancelamento';
