-- Backfill de geolocalizacao do mapa: marca quando o sync ja tentou puxar
-- lat/lng do cadastro do cliente (/api/ura/clientes/) pra esta OS, evitando
-- reconsultar pra sempre um contrato que o SGP nao geolocaliza. Aditiva.
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "geoConsultadoEm" TIMESTAMP(3);
