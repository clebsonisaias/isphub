-- Feriados (excecoes de calendario) e a remarcacao feita pelo proprio cliente.
--
-- Feriado NACIONAL nao entra em tabela: e calculado, pra ninguem precisar
-- lembrar de cadastrar dezembro. Aqui ficam so os municipais e os mutiroes.
CREATE TABLE "excecoes_agenda" (
    "id" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    -- false = nao atende. true = atende MESMO assim (ganha de domingo e de
    -- feriado nacional) — e o override humano.
    "atende" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT NOT NULL,
    "definidoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "excecoes_agenda_pkey" PRIMARY KEY ("id")
);

-- Um dia, uma regra: recadastrar ATUALIZA, nao empilha duas que discordariam.
CREATE UNIQUE INDEX "excecoes_agenda_dia_key" ON "excecoes_agenda"("dia");

-- Aditivas e com padrao: agendamento existente continua exatamente como esta.
ALTER TABLE "agendamentos" ADD COLUMN "confirmadoEm" TIMESTAMP(3);
ALTER TABLE "agendamentos" ADD COLUMN "remarcacoesCliente" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agenda_config" ADD COLUMN "remarcacoesMaxCliente" INTEGER NOT NULL DEFAULT 2;
