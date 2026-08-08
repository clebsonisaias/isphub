-- Onde o tecnico estava quando marcou a caminho / chegou / concluiu.
--
-- Nulaveis: a permissao de localizacao pode estar negada, e a acao tem de
-- acontecer do mesmo jeito. Nao ha backfill — evento antigo nao tem posicao e
-- nunca vai ter; NULL aqui significa "nao sabemos", que e a verdade.
ALTER TABLE "os_eventos" ADD COLUMN     "lat" DOUBLE PRECISION;
ALTER TABLE "os_eventos" ADD COLUMN     "lng" DOUBLE PRECISION;
