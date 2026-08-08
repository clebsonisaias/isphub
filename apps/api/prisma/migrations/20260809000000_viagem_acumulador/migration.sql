-- A viagem ABERTA e o acumulador — e um acumulador precisa lembrar do ultimo
-- ponto.
--
-- `segmentarViagens` roda sobre a serie inteira e sempre tem o ponto anterior na
-- mao. A COLETA nao: ela recebe um ponto por minuto e nao carrega o dia. Para
-- somar distancia (haversine do anterior ate o novo) e tempo parado (o intervalo
-- entre dois pontos lentos), a linha aberta precisa guardar QUANDO e A QUE
-- VELOCIDADE foi o ultimo ponto.
--
-- `latFim`/`lngFim` ja cumprem esse papel para a coordenada: enquanto a viagem
-- esta aberta, "fim" quer dizer "ate agora". Faltavam o carimbo e a velocidade.
--
-- Aditiva e anulavel: nenhuma viagem existe ainda em producao, e a coluna nula
-- diz a verdade sobre uma linha que porventura exista — nao sabemos o ultimo
-- ponto dela.

ALTER TABLE "viagens"
  ADD COLUMN "ultimoEm"            TIMESTAMP(3),
  ADD COLUMN "ultimaVelocidadeKmh" DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- E TIRA as tres travas de notificacao do rastreador.
--
-- Elas foram criadas na migracao anterior "no padrao de slaNotificadoEm", mas
-- ao escrever o job ficou claro que seriam um SEGUNDO mecanismo de idempotencia
-- competindo com um melhor que ja existe: a chave natural
-- `(rastreadorId, tipo, em)` de `eventos_rastreador`, ancorada no relogio do
-- APARELHO.
--
-- A diferenca importa com duas replicas. Uma coluna `offlineNotificadoEm` e
-- last-writer-wins: as duas replicas leem null, as duas notificam, as duas
-- carimbam — e o alerta sai dobrado. A chave natural recusa a segunda insercao
-- no banco, que e o unico lugar onde as replicas concordam.
--
-- Nenhuma das colunas chegou a receber dado: a migracao que as criou nao foi
-- para producao.
ALTER TABLE "rastreadores"
  DROP COLUMN "bateriaNotificadaEm",
  DROP COLUMN "offlineNotificadoEm",
  DROP COLUMN "bloqueioNotificadoEm";
