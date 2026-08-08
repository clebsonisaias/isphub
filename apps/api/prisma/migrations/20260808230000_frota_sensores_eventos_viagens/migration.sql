-- FROTA — sensores completos, eventos e viagens.
--
-- Toda esta migracao e ADITIVA: colunas novas anulaveis, tabelas novas, enums
-- novos. Nada e removido nem reescrito. O motivo e concreto: `migrate deploy`
-- roda no CMD do container, e um erro aqui impede a API de subir. Uma migracao
-- que so acrescenta nao tem como colidir com o dado que ja esta la.
--
-- As posicoes ja gravadas ficam com `ignicao`, `bateriaPct`, `bloqueado` e
-- `sensores` NULOS — e isso e a verdade sobre elas: foram coletadas por um
-- codigo que jogava esses campos fora. Preencher com `false` afirmaria que o
-- motor estava desligado e que o carro nao estava bloqueado em cada uma das
-- posicoes historicas, sem ninguem ter medido.

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE "EstadoIgnicao" AS ENUM ('ligada', 'desligada', 'anomalia');

CREATE TYPE "EventoRastreadorTipo" AS ENUM (
  'ignicao_ligada',
  'ignicao_desligada',
  'ignicao_anomalia',
  'bloqueio_ativado',
  'bloqueio_removido',
  'bateria_baixa',
  'bateria_normalizada',
  'ficou_offline',
  'voltou_online',
  'excesso_velocidade',
  'parado_com_motor_ligado'
);

-- ---------------------------------------------------------------------------
-- POSICAO: os tres de primeira classe + o mapa cru
-- ---------------------------------------------------------------------------

ALTER TABLE "posicoes_rastreador"
  ADD COLUMN "ignicao"    "EstadoIgnicao",
  ADD COLUMN "bateriaPct" INTEGER,
  ADD COLUMN "bloqueado"  BOOLEAN,
  ADD COLUMN "sensores"   JSONB;

-- ---------------------------------------------------------------------------
-- RASTREADOR: estado corrente, cadastro do fornecedor, travas do sino
-- ---------------------------------------------------------------------------

ALTER TABLE "rastreadores"
  ADD COLUMN "ignicao"    "EstadoIgnicao",
  ADD COLUMN "bateriaPct" INTEGER,
  ADD COLUMN "bloqueado"  BOOLEAN,
  ADD COLUMN "sensores"   JSONB,
  ADD COLUMN "modeloFornecedor"       VARCHAR(60),
  ADD COLUMN "nomeFornecedor"         VARCHAR(120),
  ADD COLUMN "intervaloFornecedorSeg" INTEGER,
  ADD COLUMN "temComandoCorte"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "instaladoEm"            TIMESTAMP(3),
  ADD COLUMN "bateriaNotificadaEm"    TIMESTAMP(3),
  ADD COLUMN "offlineNotificadoEm"    TIMESTAMP(3),
  ADD COLUMN "bloqueioNotificadoEm"   TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- CONFIG: dicionario do fornecedor e limite de velocidade
-- ---------------------------------------------------------------------------

ALTER TABLE "rastreador_configs"
  ADD COLUMN "limiteVelocidadeKmh" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "dicionarioSensores"  JSONB,
  ADD COLUMN "dicionarioEm"        TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- EVENTOS
-- ---------------------------------------------------------------------------

CREATE TABLE "eventos_rastreador" (
  "id"           TEXT NOT NULL,
  "rastreadorId" TEXT NOT NULL,
  "veiculoId"    TEXT,
  "tipo"         "EventoRastreadorTipo" NOT NULL,
  "em"           TIMESTAMP(3) NOT NULL,
  "lat"          DOUBLE PRECISION,
  "lng"          DOUBLE PRECISION,
  "detalhe"      JSONB,
  "notificadoEm" TIMESTAMP(3),
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "eventos_rastreador_pkey" PRIMARY KEY ("id")
);

-- Chave NATURAL do evento: aparelho + tipo + carimbo DO APARELHO.
--
-- Duas replicas rodando a mesma coleta derivam o MESMO evento do mesmo par de
-- leituras. Sem isto, cada replica criaria a sua e o sino tocaria duas vezes.
-- O carimbo e o do dispositivo justamente porque `criadoEm` difere entre
-- replicas e destruiria a igualdade.
CREATE UNIQUE INDEX "eventos_rastreador_chave_natural"
  ON "eventos_rastreador"("rastreadorId", "tipo", "em");

CREATE INDEX "eventos_rastreador_veiculoId_em_idx" ON "eventos_rastreador"("veiculoId", "em");

-- O job de alertas busca exatamente `notificadoEm IS NULL`. Indice parcial
-- porque a fila pendente e minuscula perto do historico inteiro.
CREATE INDEX "eventos_rastreador_pendentes"
  ON "eventos_rastreador"("notificadoEm") WHERE "notificadoEm" IS NULL;

ALTER TABLE "eventos_rastreador"
  ADD CONSTRAINT "eventos_rastreador_rastreadorId_fkey"
  FOREIGN KEY ("rastreadorId") REFERENCES "rastreadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eventos_rastreador"
  ADD CONSTRAINT "eventos_rastreador_veiculoId_fkey"
  FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- VIAGENS
-- ---------------------------------------------------------------------------

CREATE TABLE "viagens" (
  "id"           TEXT NOT NULL,
  "veiculoId"    TEXT NOT NULL,
  "rastreadorId" TEXT NOT NULL,
  "ocupacaoId"   TEXT,
  "inicioEm"     TIMESTAMP(3) NOT NULL,
  "fimEm"        TIMESTAMP(3),
  "latInicio"    DOUBLE PRECISION NOT NULL,
  "lngInicio"    DOUBLE PRECISION NOT NULL,
  "latFim"       DOUBLE PRECISION NOT NULL,
  "lngFim"       DOUBLE PRECISION NOT NULL,
  "distanciaMetros"         INTEGER,
  "velocidadeMaxKmh"        DOUBLE PRECISION,
  "paradoComMotorLigadoSeg" INTEGER,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "viagens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "viagens_veiculoId_inicioEm_idx" ON "viagens"("veiculoId", "inicioEm");
CREATE INDEX "viagens_rastreadorId_inicioEm_idx" ON "viagens"("rastreadorId", "inicioEm");

-- UMA VIAGEM ABERTA POR VEICULO.
--
-- Indice PARCIAL, no mesmo padrao ja provado da ocupacao: o Prisma nao sabe
-- expressar `WHERE`, entao ele e escrito a mao aqui e `migrate diff` vai propor
-- derruba-lo em toda migracao futura — nao aceite.
--
-- Sem ele, um tique que falhasse no meio deixaria uma viagem aberta e o proximo
-- abriria outra: o carro estaria em duas viagens ao mesmo tempo, e a soma de km
-- do dia contaria o mesmo trecho duas vezes.
--
-- NAO existe "uma viagem aberta por rastreador": e a mesma coisa por outro
-- caminho enquanto o vinculo for exclusivo, e restringir pelos dois so criaria
-- um segundo jeito de a insercao falhar.
CREATE UNIQUE INDEX "viagens_uma_aberta_por_veiculo"
  ON "viagens"("veiculoId") WHERE "fimEm" IS NULL;

ALTER TABLE "viagens"
  ADD CONSTRAINT "viagens_veiculoId_fkey"
  FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "viagens"
  ADD CONSTRAINT "viagens_rastreadorId_fkey"
  FOREIGN KEY ("rastreadorId") REFERENCES "rastreadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "viagens"
  ADD CONSTRAINT "viagens_ocupacaoId_fkey"
  FOREIGN KEY ("ocupacaoId") REFERENCES "ocupacoes_veiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
