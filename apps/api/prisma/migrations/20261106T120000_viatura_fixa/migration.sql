-- Carro FIXO do tecnico, definido pelo gestor. Aditiva: sem linha, tudo
-- continua como antes (escala do dia, ou o tecnico declara).
CREATE TABLE "viaturas_fixas" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "papel" "PapelOcupacao" NOT NULL DEFAULT 'motorista',
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "definidoPor" TEXT NOT NULL,
    "encerradoPor" TEXT,
    "observacao" VARCHAR(200),

    CONSTRAINT "viaturas_fixas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "viaturas_fixas_veiculoId_inicioEm_idx" ON "viaturas_fixas"("veiculoId", "inicioEm");
CREATE INDEX "viaturas_fixas_usuarioId_inicioEm_idx" ON "viaturas_fixas"("usuarioId", "inicioEm");

ALTER TABLE "viaturas_fixas" ADD CONSTRAINT "viaturas_fixas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viaturas_fixas" ADD CONSTRAINT "viaturas_fixas_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ⚠️ INDICE PARCIAL — ESCRITO A MAO. O Prisma nao expressa `WHERE` em indice e
-- o `prisma migrate diff` VAI PROPOR REMOVE-LO; remover e regressao.
-- UM carro fixo vigente por tecnico. Varios tecnicos no mesmo carro e permitido.
CREATE UNIQUE INDEX "viaturas_fixas_uma_vigente_por_usuario"
  ON "viaturas_fixas"("usuarioId") WHERE "fimEm" IS NULL;
