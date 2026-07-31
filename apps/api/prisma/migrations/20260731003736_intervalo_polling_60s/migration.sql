-- AlterTable
ALTER TABLE "erp_configs" ALTER COLUMN "intervaloPollingSegundos" SET DEFAULT 60;

-- A varredura de encerradas saiu do sync (ver syncService.ts): cada ciclo caiu
-- de ~53 pra ~4 requisicoes ao SGP, entao um intervalo 3x menor ainda reduz a
-- carga total no ERP do provedor em vez de aumentar.
--
-- So atualiza quem estava no default ANTIGO (180). Um provedor com valor
-- diferente foi configurado manualmente por um admin (ex.: um SGP mais lento
-- ou sujeito a rate limit) — essa escolha nao e nossa pra sobrescrever.
UPDATE "erp_configs" SET "intervaloPollingSegundos" = 60 WHERE "intervaloPollingSegundos" = 180;
