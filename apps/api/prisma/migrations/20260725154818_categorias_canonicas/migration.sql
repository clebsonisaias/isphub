-- Categorias canonicas da ISPhub + mapeamento de TipoOs -> Categoria.
--
-- TipoOs.categoria (enum fixo ocorrencia|instalacao) vira TipoOs.categoriaId
-- (FK nullable pra Categoria, taxonomia global e editavel pelo admin). O
-- backfill deste arquivo so resolve o caso deterministico (categoria =
-- 'instalacao' -> categoria "Instalacao"); o restante (auto-mapeamento por
-- palavra-chave sobre a descricao) roda depois, via script one-off que usa a
-- mesma logica de apps/api/src/services/categoriaMatch.ts (evita duplicar a
-- normalizacao de acento/emoji em SQL).

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#6366f1',
    "icone" TEXT,
    "palavrasChave" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slaHorasPadrao" INTEGER,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nome_key" ON "categorias"("nome");

-- Seed: categorias padrao pra uma prestadora de servico fisico de ISP
-- (reparo/instalacao). Admin pode editar cor/icone/keywords/SLA depois.
INSERT INTO "categorias" ("id", "nome", "cor", "icone", "palavrasChave", "slaHorasPadrao", "ordem") VALUES
  (gen_random_uuid(), 'Instalação', '#22c55e', 'plug', ARRAY['instal','nova instalacao','novo cliente','ativacao','ativar'], 48, 1),
  (gen_random_uuid(), 'Reparo / Sem conexão', '#ef4444', 'wifi-off', ARRAY['sem conex','reparo','reparar','corretiva','sem sinal','sem internet','oscila','lentidao'], 8, 2),
  (gen_random_uuid(), 'Manutenção', '#f59e0b', 'wrench', ARRAY['manutenc','preventiva','revisao'], 24, 3),
  (gen_random_uuid(), 'Mudança de endereço', '#3b82f6', 'home', ARRAY['mudanca','troca de endereco','transferen','mudar endereco'], 72, 4),
  (gen_random_uuid(), 'Troca de equipamento', '#8b5cf6', 'router', ARRAY['troca','equipamento','roteador','onu','modem','cabo','fonte'], 24, 5),
  (gen_random_uuid(), 'Retirada / Cancelamento', '#64748b', 'x-circle', ARRAY['retirada','cancel','desativ','remocao','recolh'], 48, 6),
  (gen_random_uuid(), 'Visita técnica', '#06b6d4', 'user-check', ARRAY['visita','vistoria'], 24, 7);

-- AlterTable: adiciona a FK nullable antes de mexer na coluna antiga.
ALTER TABLE "tipos_os" ADD COLUMN "categoriaId" TEXT;

-- Backfill deterministico: quem ja estava marcado "instalacao" no enum
-- antigo vira a categoria "Instalação" (sem depender de match por texto).
UPDATE "tipos_os"
SET "categoriaId" = (SELECT "id" FROM "categorias" WHERE "nome" = 'Instalação')
WHERE "categoria" = 'instalacao';

-- Remove a coluna/enum antigos.
ALTER TABLE "tipos_os" DROP COLUMN "categoria";
DROP TYPE "CategoriaTipoOs";

-- AddForeignKey
ALTER TABLE "tipos_os" ADD CONSTRAINT "tipos_os_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
