-- FROTA — fase 1: veiculo com dono, ocupacao por periodo, rastreador e posicoes.
--
-- Aditiva. Nao remove coluna nem tabela: /financeiro/frota continua funcionando
-- exatamente como hoje, e financeiro-frota.spec.ts e o contrato disso.

CREATE TYPE "TipoVeiculo"          AS ENUM ('carro','moto','van','caminhao','utilitario');
CREATE TYPE "StatusVeiculo"        AS ENUM ('ativo','manutencao','inativo');
CREATE TYPE "PapelOcupacao"        AS ENUM ('motorista','passageiro');
CREATE TYPE "OrigemOcupacao"       AS ENUM ('declaracao','jornada','ajuste');
CREATE TYPE "EncerramentoOcupacao" AS ENUM ('jornada','troca_veiculo','ajuste');
CREATE TYPE "RastreadorFornecedor" AS ENUM ('plataformatk');

-- ── Veiculo ────────────────────────────────────────────────────────────────
--
-- SEM BACKFILL de provedorId, e isso e a resposta CERTA, nao uma pendencia: as
-- linhas que existem hoje sao carros da propria ISPhub — a tela mora sob
-- /financeiro, que o proprio router documenta como "dinheiro da PROPRIA
-- HubISP". NULL aqui significa "da operacao", que e verdade. Escrever um
-- backfill escolhendo um provedor qualquer INVENTARIA um dono.
-- Mesmo criterio de 20260807220000_os_evento_geo.
ALTER TABLE "veiculos" ADD COLUMN "provedorId" TEXT;
ALTER TABLE "veiculos" ADD COLUMN "marca"      VARCHAR(60);
ALTER TABLE "veiculos" ADD COLUMN "cor"        VARCHAR(30);
ALTER TABLE "veiculos" ADD COLUMN "tipo"       "TipoVeiculo"   NOT NULL DEFAULT 'carro';
ALTER TABLE "veiculos" ADD COLUMN "status"     "StatusVeiculo" NOT NULL DEFAULT 'ativo';
ALTER TABLE "veiculos" ADD COLUMN "odometroKm" INTEGER;
ALTER TABLE "veiculos" ADD COLUMN "renavam"    VARCHAR(11);
ALTER TABLE "veiculos" ADD COLUMN "chassi"     VARCHAR(17);

ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_provedorId_fkey"
  FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- `ativo` (que /financeiro/frota usa) e `status` (a fonte rica) partem
-- coerentes. Daqui pra frente o service mantem os dois em sincronia.
UPDATE "veiculos" SET "status" = 'inativo' WHERE "ativo" = false;

CREATE INDEX "veiculos_provedorId_status_idx" ON "veiculos"("provedorId","status");

-- ── Placa canonica ─────────────────────────────────────────────────────────
--
-- O caminho de escrita atual (frotaService.criarVeiculo) ja fazia upper e tirava
-- ESPACO, mas nao HIFEN — entao "ABC-1234" e "ABC1234" podiam coexistir como
-- veiculos diferentes, com o vinculo do rastreador em so um deles.
--
-- Esta normalizacao NAO PODE FALHAR. `prisma migrate deploy` roda no CMD do
-- container: um RAISE EXCEPTION aqui impede a API de subir. Trocar uma duplicata
-- improvavel por uma indisponibilidade certa e a troca errada.
--
-- Entao: normaliza so o que nao colide, e AVISA (WARNING, que vai pro log do
-- container sem abortar) sobre o que sobrar. Fundir dois veiculos
-- automaticamente seria pior que os dois: moveria abastecimento de um historico
-- pro outro, em silencio.
UPDATE "veiculos" v
   SET "placa" = upper(regexp_replace(v."placa",'[^A-Za-z0-9]','','g'))
 WHERE v."placa" <> upper(regexp_replace(v."placa",'[^A-Za-z0-9]','','g'))
   AND NOT EXISTS (
     SELECT 1 FROM "veiculos" o
      WHERE o."id" <> v."id"
        AND o."placa" = upper(regexp_replace(v."placa",'[^A-Za-z0-9]','','g'))
   );

DO $$
DECLARE restantes text;
BEGIN
  SELECT string_agg("placa", ', ') INTO restantes
    FROM "veiculos"
   WHERE "placa" <> upper(regexp_replace("placa",'[^A-Za-z0-9]','','g'));
  IF restantes IS NOT NULL THEN
    RAISE WARNING 'FROTA: placa(s) nao normalizada(s) por colisao: %. Sao o MESMO carro cadastrado duas vezes — resolva a mao (mova os abastecimentos e apague a duplicata).', restantes;
  END IF;
END $$;

-- ── Ocupacao ───────────────────────────────────────────────────────────────
CREATE TABLE "ocupacoes_veiculo" (
  "id"             TEXT NOT NULL,
  "veiculoId"      TEXT NOT NULL,
  "usuarioId"      TEXT NOT NULL,
  "inicioEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fimEm"          TIMESTAMP(3),
  "papel"          "PapelOcupacao" NOT NULL DEFAULT 'motorista',
  "origem"         "OrigemOcupacao" NOT NULL,
  "declaradoPorId" TEXT NOT NULL,
  "encerradoPor"   "EncerramentoOcupacao",
  "jornadaId"      TEXT,
  "ordemServicoId" TEXT,
  "odometroInicio" INTEGER,
  "odometroFim"    INTEGER,
  "latInicio"      DOUBLE PRECISION,
  "lngInicio"      DOUBLE PRECISION,
  "latFim"         DOUBLE PRECISION,
  "lngFim"         DOUBLE PRECISION,
  "observacao"     VARCHAR(200),
  "criadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ocupacoes_veiculo_pkey" PRIMARY KEY ("id")
);

-- ── Rastreador ─────────────────────────────────────────────────────────────
CREATE TABLE "rastreadores" (
  "id"                   TEXT NOT NULL,
  "provedorId"           TEXT,
  "fornecedor"           "RastreadorFornecedor" NOT NULL DEFAULT 'plataformatk',
  "identificadorExterno" VARCHAR(60) NOT NULL,
  "apelido"              VARCHAR(60),
  "ativo"                BOOLEAN NOT NULL DEFAULT true,
  "ultimaPosicaoEm"      TIMESTAMP(3),
  "ultimoStatusEm"       TIMESTAMP(3),
  "comunicando"          BOOLEAN,
  "rastreando"           BOOLEAN,
  "criadoEm"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rastreadores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vinculos_rastreador" (
  "id"           TEXT NOT NULL,
  "veiculoId"    TEXT NOT NULL,
  "rastreadorId" TEXT NOT NULL,
  "inicioEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fimEm"        TIMESTAMP(3),
  "criadoPorId"  TEXT,
  "observacao"   VARCHAR(200),
  CONSTRAINT "vinculos_rastreador_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "posicoes_rastreador" (
  "id"            TEXT NOT NULL,
  "rastreadorId"  TEXT NOT NULL,
  "registradoEm"  TIMESTAMP(3) NOT NULL,
  "lat"           DOUBLE PRECISION NOT NULL,
  "lng"           DOUBLE PRECISION NOT NULL,
  "velocidadeKmh" DOUBLE PRECISION,
  "movendo"       BOOLEAN,
  "comunicando"   BOOLEAN,
  "rastreando"    BOOLEAN,
  "coletadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "posicoes_rastreador_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rastreador_configs" (
  "id"                       TEXT NOT NULL,
  "provedorId"               TEXT,
  "fornecedor"               "RastreadorFornecedor" NOT NULL DEFAULT 'plataformatk',
  "baseUrl"                  TEXT NOT NULL DEFAULT 'https://api.plataformatk.com.br',
  "chaveCifrada"             TEXT NOT NULL,
  "intervaloPollingSegundos" INTEGER NOT NULL DEFAULT 60,
  "ativo"                    BOOLEAN NOT NULL DEFAULT true,
  "ultimaColetaEm"           TIMESTAMP(3),
  "ultimaColetaOk"           BOOLEAN,
  "ultimaColetaMensagem"     TEXT,
  "criadoEm"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rastreador_configs_pkey" PRIMARY KEY ("id")
);

-- ── FKs ────────────────────────────────────────────────────────────────────
-- RESTRICT em veiculo/usuario de proposito: apagar um veiculo NAO pode apagar
-- por onde ele andou nem quem esteve nele. Veiculo se aposenta com
-- status='inativo'. (A origem apagava um veiculo com ~20 statements soltos em
-- 12 tabelas, destruindo ate lancamento financeiro ja postado.)
ALTER TABLE "ocupacoes_veiculo" ADD CONSTRAINT "ocupacoes_veiculo_veiculoId_fkey"
  FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ocupacoes_veiculo" ADD CONSTRAINT "ocupacoes_veiculo_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ocupacoes_veiculo" ADD CONSTRAINT "ocupacoes_veiculo_declaradoPorId_fkey"
  FOREIGN KEY ("declaradoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ocupacoes_veiculo" ADD CONSTRAINT "ocupacoes_veiculo_jornadaId_fkey"
  FOREIGN KEY ("jornadaId") REFERENCES "jornadas_tecnico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ocupacoes_veiculo" ADD CONSTRAINT "ocupacoes_veiculo_ordemServicoId_fkey"
  FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rastreadores" ADD CONSTRAINT "rastreadores_provedorId_fkey"
  FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vinculos_rastreador" ADD CONSTRAINT "vinculos_rastreador_veiculoId_fkey"
  FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vinculos_rastreador" ADD CONSTRAINT "vinculos_rastreador_rastreadorId_fkey"
  FOREIGN KEY ("rastreadorId") REFERENCES "rastreadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vinculos_rastreador" ADD CONSTRAINT "vinculos_rastreador_criadoPorId_fkey"
  FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CASCADE aqui, ao contrario dos de cima: posicao sem rastreador nao significa
-- nada — nao ha o que preservar.
ALTER TABLE "posicoes_rastreador" ADD CONSTRAINT "posicoes_rastreador_rastreadorId_fkey"
  FOREIGN KEY ("rastreadorId") REFERENCES "rastreadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rastreador_configs" ADD CONSTRAINT "rastreador_configs_provedorId_fkey"
  FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Indices de leitura ─────────────────────────────────────────────────────
CREATE INDEX "ocupacoes_veiculo_veiculoId_inicioEm_idx" ON "ocupacoes_veiculo"("veiculoId","inicioEm");
CREATE INDEX "ocupacoes_veiculo_usuarioId_inicioEm_idx" ON "ocupacoes_veiculo"("usuarioId","inicioEm");
CREATE INDEX "ocupacoes_veiculo_jornadaId_idx"          ON "ocupacoes_veiculo"("jornadaId");
CREATE INDEX "ocupacoes_veiculo_ordemServicoId_idx"     ON "ocupacoes_veiculo"("ordemServicoId");
CREATE UNIQUE INDEX "rastreadores_fornecedor_identificadorExterno_key"
  ON "rastreadores"("fornecedor","identificadorExterno");
CREATE INDEX "rastreadores_provedorId_ativo_idx" ON "rastreadores"("provedorId","ativo");
CREATE INDEX "vinculos_rastreador_veiculoId_inicioEm_idx"    ON "vinculos_rastreador"("veiculoId","inicioEm");
CREATE INDEX "vinculos_rastreador_rastreadorId_inicioEm_idx" ON "vinculos_rastreador"("rastreadorId","inicioEm");

-- IDEMPOTENCIA QUE SOBREVIVE A DUAS REPLICAS.
-- A chave natural e (rastreador, carimbo DO RASTREADOR). Duas replicas
-- consultando o fornecedor na mesma janela recebem o MESMO `time`; a segunda
-- insercao bate aqui e e descartada por `skipDuplicates`. Usar `coletadoEm` na
-- chave seria a versao que NAO funciona: cada replica tem o seu, e a tabela
-- dobraria a cada replica com zero informacao nova.
-- Serve tambem de indice de leitura da trilha — mesmas colunas-lider.
CREATE UNIQUE INDEX "posicoes_rastreador_ponto_unico"
  ON "posicoes_rastreador"("rastreadorId","registradoEm");

-- ── ⚠️ INDICES PARCIAIS — ESCRITOS A MAO ───────────────────────────────────
--
-- O Prisma NAO expressa `WHERE` em indice, entao eles nao existem no
-- schema.prisma e o `prisma migrate diff` VAI PROPOR REMOVE-LOS. Remover e
-- REGRESSAO, nao limpeza. Mesmo aviso de jornadas_tecnico_uma_aberta_por_usuario.

-- (1) UMA ocupacao aberta POR TECNICO. E ISTO que responde "quem vence" quando
-- duas pessoas afirmam coisas diferentes: o banco fisicamente nao consegue
-- guardar alguem em dois carros ao mesmo tempo. Sem isto, "quem estava no
-- carro" vira uma lista de palpites.
CREATE UNIQUE INDEX "ocupacoes_veiculo_uma_aberta_por_usuario"
  ON "ocupacoes_veiculo"("usuarioId") WHERE "fimEm" IS NULL;

-- (2) UM MOTORISTA aberto por veiculo.
-- NAO existe "uma ocupacao aberta por veiculo": N tecnicos no mesmo carro E O
-- OBJETIVO do modelo, e um indice assim seria a regressao. O que nao existe e
-- DOIS motoristas do mesmo carro.
CREATE UNIQUE INDEX "ocupacoes_veiculo_um_motorista_aberto_por_veiculo"
  ON "ocupacoes_veiculo"("veiculoId") WHERE "fimEm" IS NULL AND "papel" = 'motorista';

-- (3) e (4) O vinculo vale nos DOIS sentidos, e nenhum implica o outro:
-- (3) impede um carro com dois rastreadores; (4) impede um rastreador
-- reivindicado por dois carros — o bug que poe um carro no mapa na posicao de
-- outro. Juntos sao o item "historico do rastreador": trocar o aparelho de
-- carro fecha o periodo e abre outro, sem apagar o anterior.
CREATE UNIQUE INDEX "vinculos_rastreador_um_ativo_por_veiculo"
  ON "vinculos_rastreador"("veiculoId") WHERE "fimEm" IS NULL;
CREATE UNIQUE INDEX "vinculos_rastreador_um_ativo_por_rastreador"
  ON "vinculos_rastreador"("rastreadorId") WHERE "fimEm" IS NULL;

-- (5) e (6) Config: uma por (provedor, fornecedor), e EXATAMENTE UMA da propria
-- operacao. Um unique comum em (provedorId, fornecedor) aceitaria N configs da
-- hub, porque o Postgres trata NULL como DISTINTO — a mesma armadilha que fez o
-- indice da jornada precisar ser parcial.
CREATE UNIQUE INDEX "rastreador_configs_por_provedor"
  ON "rastreador_configs"("provedorId","fornecedor") WHERE "provedorId" IS NOT NULL;
CREATE UNIQUE INDEX "rastreador_configs_da_hub"
  ON "rastreador_configs"("fornecedor") WHERE "provedorId" IS NULL;

-- ── Sobreposicao de periodos JA FECHADOS ───────────────────────────────────
--
-- Os indices parciais so governam a linha ABERTA. Um ajuste de gestor pode
-- inserir um periodo fechado 13:00-15:00 sobrepondo um 13:30-14:30 existente —
-- e ai a pessoa estaria em dois carros as 14:00, no passado.
--
-- Envolvido em bloco com EXCEPTION porque `CREATE EXTENSION` exige privilegio
-- que nem todo Postgres gerenciado concede. Em PL/pgSQL o handler abre uma
-- subtransacao, entao a falha e contida: perde-se a restricao, NAO a migracao —
-- e a API sobe. O aviso fica no log do container.
--
-- `tsrange` e nao `tstzrange`: o DateTime do Prisma e timestamp(3) SEM fuso.
-- `[)` semiaberto — a mesma convencao das consultas, pra que uma troca as 13:30
-- em ponto ponha a pessoa em exatamente um veiculo.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "ocupacoes_veiculo"
    ADD CONSTRAINT "ocupacoes_veiculo_sem_sobreposicao_fechada"
    EXCLUDE USING gist (
      "usuarioId" WITH =,
      tsrange("inicioEm", "fimEm", '[)') WITH &&
    ) WHERE ("fimEm" IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'FROTA: nao foi possivel criar a restricao de sobreposicao (%). Os indices parciais, que sao a parte inegociavel, estao de pe; a checagem de periodo fechado fica no service.', SQLERRM;
END $$;

-- ── PROVA ANTIRREGRESSAO ───────────────────────────────────────────────────
--
-- Roda em milissegundos, nao toca em dado nenhum, e falha ALTO se um
-- `migrate diff` futuro tirar o indice OU o WHERE dele. Aqui EXCEPTION e
-- correto: se estes indices nao existirem, o modelo de ocupacao nao vale nada, e
-- subir assim seria pior que nao subir.
DO $$
DECLARE faltando text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE tablename='ocupacoes_veiculo' AND indexname='ocupacoes_veiculo_uma_aberta_por_usuario'
        AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%fimEm% IS NULL%')
    THEN faltando := faltando || ' ocupacoes_veiculo_uma_aberta_por_usuario'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE tablename='ocupacoes_veiculo' AND indexname='ocupacoes_veiculo_um_motorista_aberto_por_veiculo'
        AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%motorista%')
    THEN faltando := faltando || ' ocupacoes_veiculo_um_motorista_aberto_por_veiculo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE tablename='vinculos_rastreador' AND indexname='vinculos_rastreador_um_ativo_por_rastreador'
        AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%fimEm% IS NULL%')
    THEN faltando := faltando || ' vinculos_rastreador_um_ativo_por_rastreador'; END IF;
  IF faltando <> '' THEN
    RAISE EXCEPTION 'REGRESSAO: indice(s) parcial(is) da frota ausente(s) ou sem o WHERE:%', faltando;
  END IF;
END $$;
