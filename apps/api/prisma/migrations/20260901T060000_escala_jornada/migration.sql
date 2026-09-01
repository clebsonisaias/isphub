-- Escala do dia: quem vai em qual viatura, em que papel. Quem decide passa a
-- ser o supervisor; o app do tecnico so mostra.
CREATE TABLE "escalas_jornada" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "veiculoId" TEXT,
    "papel" "PapelOcupacao" NOT NULL DEFAULT 'motorista',
    "dia" DATE NOT NULL,
    "definidoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "escalas_jornada_pkey" PRIMARY KEY ("id")
);

-- Uma escala por pessoa por dia: reescalar ATUALIZA, nao empilha.
CREATE UNIQUE INDEX "escalas_jornada_usuarioId_dia_key" ON "escalas_jornada"("usuarioId", "dia");
-- Serve a pergunta "quem esta neste carro hoje?", que e como o parceiro e
-- derivado (nao ha tabela de parceiros).
CREATE INDEX "escalas_jornada_dia_veiculoId_idx" ON "escalas_jornada"("dia", "veiculoId");

ALTER TABLE "escalas_jornada" ADD CONSTRAINT "escalas_jornada_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escalas_jornada" ADD CONSTRAINT "escalas_jornada_veiculoId_fkey"
    FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
