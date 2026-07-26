-- Tecnicos passam a ser usuarios da ISPhub (role=tecnico), nao mais pessoal
-- importado do SGP de cada provedor. A tabela "tecnicos" (que so existia via
-- sync do SGP) e removida; OrdemServico.tecnicoId e Atribuicao.tecnicoId
-- passam a referenciar "usuarios" diretamente.
--
-- DESTRUTIVA: os tecnicos antigos (pessoal do provedor, nao da ISPhub) somem
-- e as atribuicoes feitas a eles sao apagadas — nao fazem mais sentido depois
-- da mudanca de modelo. O nome do tecnico que o SGP mandava por OS e
-- preservado abaixo em "tecnicoSgpNome" antes do drop, so como informativo.

-- AlterTable: nova coluna antes do backfill.
ALTER TABLE "ordens_servico" ADD COLUMN "tecnicoSgpNome" TEXT;

-- Backfill: preserva o nome do tecnico do SGP (que ate aqui so existia via
-- FK pra "tecnicos") antes de apagar essa tabela.
UPDATE "ordens_servico" os
SET "tecnicoSgpNome" = t."nome"
FROM "tecnicos" t
WHERE os."tecnicoId" = t."id";

-- DropForeignKey
ALTER TABLE "atribuicoes" DROP CONSTRAINT "atribuicoes_tecnicoId_fkey";
ALTER TABLE "ordens_servico" DROP CONSTRAINT "ordens_servico_tecnicoId_fkey";
ALTER TABLE "tecnicos" DROP CONSTRAINT "tecnicos_provedorId_fkey";
ALTER TABLE "tecnicos" DROP CONSTRAINT "tecnicos_usuarioId_fkey";

-- Limpa referencias aos tecnicos antigos (IDs de "tecnicos" nao existem em
-- "usuarios" — nao ha como remapear, so zerar).
UPDATE "ordens_servico" SET "tecnicoId" = NULL WHERE "tecnicoId" IS NOT NULL;
DELETE FROM "atribuicoes";

-- DropTable
DROP TABLE "tecnicos";

-- CreateIndex
CREATE INDEX "ordens_servico_tecnicoId_idx" ON "ordens_servico"("tecnicoId");

-- AddForeignKey: agora tecnicoId aponta pra usuarios (role=tecnico).
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "atribuicoes" ADD CONSTRAINT "atribuicoes_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
