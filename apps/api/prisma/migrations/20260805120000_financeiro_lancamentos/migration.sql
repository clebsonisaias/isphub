-- CreateEnum
CREATE TYPE "LancamentoTipo" AS ENUM ('receita', 'despesa');

-- CreateEnum
CREATE TYPE "LancamentoStatus" AS ENUM ('pendente', 'pago', 'cancelado');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'outro');

-- CreateEnum
CREATE TYPE "LancamentoEventoTipo" AS ENUM ('criado', 'editado', 'baixado', 'estornado', 'cancelado');

-- CreateTable
CREATE TABLE "categorias_financeiras" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "LancamentoTipo" NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#6366f1',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "tipo" "LancamentoTipo" NOT NULL,
    "status" "LancamentoStatus" NOT NULL DEFAULT 'pendente',
    "descricao" VARCHAR(200) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "competencia" DATE NOT NULL,
    "pagoEm" DATE,
    "valorPago" DECIMAL(14,2),
    "formaPagamento" "FormaPagamento",
    "provedorId" TEXT,
    "categoriaId" TEXT,
    "observacao" VARCHAR(500),
    "comprovanteDados" BYTEA,
    "comprovanteMime" TEXT,
    "comprovanteNome" VARCHAR(200),
    "comprovanteTamanho" INTEGER,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamento_eventos" (
    "id" TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "tipo" "LancamentoEventoTipo" NOT NULL,
    "autorId" TEXT,
    "detalhe" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lancamento_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_financeiras_nome_key" ON "categorias_financeiras"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_numero_key" ON "lancamentos"("numero");

-- CreateIndex
CREATE INDEX "lancamentos_status_vencimento_idx" ON "lancamentos"("status", "vencimento");

-- CreateIndex
CREATE INDEX "lancamentos_tipo_competencia_idx" ON "lancamentos"("tipo", "competencia");

-- CreateIndex
CREATE INDEX "lancamentos_provedorId_idx" ON "lancamentos"("provedorId");

-- CreateIndex
CREATE INDEX "lancamento_eventos_lancamentoId_criadoEm_idx" ON "lancamento_eventos"("lancamentoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_eventos" ADD CONSTRAINT "lancamento_eventos_lancamentoId_fkey" FOREIGN KEY ("lancamentoId") REFERENCES "lancamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_eventos" ADD CONSTRAINT "lancamento_eventos_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

