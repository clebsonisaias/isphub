-- CreateTable
CREATE TABLE "jornadas_tecnico" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "latInicio" DOUBLE PRECISION,
    "lngInicio" DOUBLE PRECISION,
    "latFim" DOUBLE PRECISION,
    "lngFim" DOUBLE PRECISION,

    CONSTRAINT "jornadas_tecnico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jornadas_tecnico_usuarioId_inicioEm_idx" ON "jornadas_tecnico"("usuarioId", "inicioEm");

-- AddForeignKey
ALTER TABLE "jornadas_tecnico" ADD CONSTRAINT "jornadas_tecnico_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠️ INDICE PARCIAL — ESCRITO A MAO, E O `migrate diff` VAI QUERER REMOVER.
--
-- Garante UMA jornada aberta por tecnico no BANCO, nao num `if` do service.
-- Checar-antes-de-inserir tem janela de corrida: dois toques no botao (ou duas
-- instancias da API) passam os dois pela checagem e criam duas jornadas — e a
-- partir dai "tempo trabalhado" vira ficcao, sem ninguem perceber.
--
-- Postgres trata NULLs como distintos em indice unico comum, entao
-- `@@unique([usuarioId, fimEm])` NAO resolveria: varias linhas com fimEm=NULL
-- seriam aceitas. O `WHERE` e o que faz a regra existir.
--
-- Indice parcial nao e expressavel no schema.prisma. Se uma migracao futura
-- gerada automaticamente propuser DROP deste indice, isso e REGRESSAO — o
-- doc-comment do modelo JornadaTecnico repete este aviso.
CREATE UNIQUE INDEX "jornadas_tecnico_uma_aberta_por_usuario"
    ON "jornadas_tecnico"("usuarioId") WHERE "fimEm" IS NULL;
