-- A agenda de OS: substitui a planilha "Controle de Agendamento de OSs".
--
-- Duas tabelas: a GRADE (quantas visitas cabem por turno) e as MARCACOES.
-- Aditiva — nada existente e tocado, e em especial `ordens_servico` fica igual:
-- `dataAgendamento` continua sendo espelho puro do SGP.

CREATE TYPE "TurnoAgenda" AS ENUM ('manha', 'tarde');
CREATE TYPE "StatusAgendamento" AS ENUM ('marcado', 'cancelado');

-- Uma linha so (id = 'global'). A capacidade e da EQUIPE, nao do contrato.
CREATE TABLE "agenda_config" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "vagasManha" INTEGER NOT NULL DEFAULT 20,
    "vagasTarde" INTEGER NOT NULL DEFAULT 20,
    "tetoRegiao" INTEGER,
    "diasAtendidos" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "horizonteDias" INTEGER NOT NULL DEFAULT 14,
    "antecedenciaMin" INTEGER NOT NULL DEFAULT 120,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agenda_config_pkey" PRIMARY KEY ("id")
);

-- Nasce com os defaults ja materializados: a grade e pergunta de todo request
-- de vagas, e "linha ausente" seria um segundo estado significando a mesma
-- coisa que "linha com os padroes".
INSERT INTO "agenda_config" ("id", "atualizadoEm") VALUES ('global', CURRENT_TIMESTAMP);

CREATE TABLE "agendamentos" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    -- Chave estavel: quem marca recebe o id do SGP na hora, mas o espelho so
    -- ve a OS no ciclo seguinte (ate ~3 min). Ver o comentario no schema.
    "sgpOsId" TEXT NOT NULL,
    "ordemServicoId" TEXT,
    "dia" DATE NOT NULL,
    "turno" "TurnoAgenda" NOT NULL,
    "regiao" TEXT,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'marcado',
    "ordemRota" INTEGER,
    "origem" TEXT NOT NULL,
    "marcadoPor" TEXT,
    "observacao" TEXT,
    "sgpConfirmadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id")
);

-- Uma marcacao por OS: remarcar ATUALIZA a linha, nao empilha uma segunda que
-- competiria com a primeira pela mesma vaga (mesma decisao de escalas_jornada).
CREATE UNIQUE INDEX "agendamentos_provedorId_sgpOsId_key" ON "agendamentos"("provedorId", "sgpOsId");
CREATE UNIQUE INDEX "agendamentos_ordemServicoId_key" ON "agendamentos"("ordemServicoId");
-- A contagem de ocupacao do turno — a pergunta feita a cada consulta de vagas.
CREATE INDEX "agendamentos_dia_turno_status_idx" ON "agendamentos"("dia", "turno", "status");
-- O teto regional.
CREATE INDEX "agendamentos_dia_regiao_status_idx" ON "agendamentos"("dia", "regiao", "status");

ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_provedorId_fkey"
    FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_ordemServicoId_fkey"
    FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
