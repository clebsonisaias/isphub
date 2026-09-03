-- A chave que o AtendAI usa pra entrar no ISPhub (sentido oposto ao de
-- `chaveCifrada`, que e a NOSSA credencial pra falar com ele).
--
-- HASH e nao cifrada: nunca precisa ser lida de volta, so comparada. Cifrar
-- daria a capacidade de exibi-la, que e a capacidade que nao se quer ter num
-- segredo de entrada. Aditiva e toda nulavel — provedor sem chave gerada
-- continua exatamente como estava.
ALTER TABLE "atendai_configs" ADD COLUMN "chaveEntradaHash" TEXT;
ALTER TABLE "atendai_configs" ADD COLUMN "chaveEntradaPrefixo" TEXT;
ALTER TABLE "atendai_configs" ADD COLUMN "chaveEntradaUsoEm" TIMESTAMP(3);

-- Unico pro lookup por prefixo. NULL nao colide com NULL em Postgres, entao
-- todos os provedores sem chave convivem sob a mesma restricao.
CREATE UNIQUE INDEX "atendai_configs_chaveEntradaPrefixo_key" ON "atendai_configs"("chaveEntradaPrefixo");
