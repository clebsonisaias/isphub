-- AlterTable
ALTER TABLE "ocorrencias" ADD COLUMN     "clienteNome" TEXT,
ADD COLUMN     "contratoStatus" TEXT,
ADD COLUMN     "dataFinalizacao" TIMESTAMP(3),
ADD COLUMN     "metodo" TEXT,
ADD COLUMN     "pop" TEXT,
ADD COLUMN     "usuario" TEXT;

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "contratoStatus" TEXT,
ADD COLUMN     "dataCadastro" TIMESTAMP(3),
ADD COLUMN     "pop" TEXT,
ADD COLUMN     "usuario" TEXT;
