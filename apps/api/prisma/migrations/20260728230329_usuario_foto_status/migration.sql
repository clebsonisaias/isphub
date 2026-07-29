-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "fotoDados" BYTEA,
ADD COLUMN     "fotoMime" TEXT,
ADD COLUMN     "fotoVersao" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "statusTexto" VARCHAR(140),
ADD COLUMN     "temFoto" BOOLEAN NOT NULL DEFAULT false;
