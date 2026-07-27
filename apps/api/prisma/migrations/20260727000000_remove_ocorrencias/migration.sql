-- Remove ocorrencias do ISPhub: a empresa trabalha so com Ordens de Servico.
-- O dado original permanece no SGP de cada provedor (esta tabela era so um
-- espelho de leitura). IF EXISTS mantem a migracao idempotente caso a tabela
-- ja tenha sido dropada manualmente. CASCADE derruba a FK para "provedores".

-- DropTable
DROP TABLE IF EXISTS "ocorrencias" CASCADE;

-- Limpa o historico de sync orfao do recurso removido (inofensivo se vazio).
DELETE FROM "sync_logs" WHERE "recurso" = 'ocorrencia';
