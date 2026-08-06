-- CreateEnum
CREATE TYPE "TipoCombustivel" AS ENUM ('gasolina', 'etanol', 'diesel', 'gnv', 'eletrico');

-- CreateEnum
CREATE TYPE "MovimentoCartaoTipo" AS ENUM ('deposito', 'consumo', 'estorno');

-- CreateTable
CREATE TABLE "veiculos" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "modelo" VARCHAR(80) NOT NULL,
    "ano" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "veiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abastecimentos" (
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "km" INTEGER NOT NULL,
    "litros" DECIMAL(10,3) NOT NULL,
    "valorTotal" DECIMAL(14,2) NOT NULL,
    "combustivel" "TipoCombustivel" NOT NULL DEFAULT 'gasolina',
    "posto" VARCHAR(120),
    "tanqueCheio" BOOLEAN NOT NULL DEFAULT true,
    "lancamentoId" TEXT,
    "responsavelId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abastecimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cartoes_combustivel" (
    "id" TEXT NOT NULL,
    "numero" VARCHAR(40) NOT NULL,
    "titularId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cartoes_combustivel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_cartao" (
    "id" TEXT NOT NULL,
    "cartaoId" TEXT NOT NULL,
    "tipo" "MovimentoCartaoTipo" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "data" DATE NOT NULL,
    "descricao" VARCHAR(200),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_cartao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_placa_key" ON "veiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "abastecimentos_lancamentoId_key" ON "abastecimentos"("lancamentoId");

-- CreateIndex
CREATE INDEX "abastecimentos_veiculoId_data_idx" ON "abastecimentos"("veiculoId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "abastecimentos_veiculoId_km_key" ON "abastecimentos"("veiculoId", "km");

-- CreateIndex
CREATE UNIQUE INDEX "cartoes_combustivel_numero_key" ON "cartoes_combustivel"("numero");

-- CreateIndex
CREATE INDEX "movimentos_cartao_cartaoId_data_idx" ON "movimentos_cartao"("cartaoId", "data");

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_lancamentoId_fkey" FOREIGN KEY ("lancamentoId") REFERENCES "lancamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartoes_combustivel" ADD CONSTRAINT "cartoes_combustivel_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_cartao" ADD CONSTRAINT "movimentos_cartao_cartaoId_fkey" FOREIGN KEY ("cartaoId") REFERENCES "cartoes_combustivel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

