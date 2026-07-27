-- Telefone/contato do cliente, do cadastro no SGP (/api/ura/clientes/). A
-- listagem de OS nao traz — vem no mesmo backfill do endereco/geo. Aditiva.
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "telefone" TEXT;
