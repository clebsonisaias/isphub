-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'gestor', 'tecnico', 'provedor');

-- CreateEnum
CREATE TYPE "ErpTipo" AS ENUM ('SGP');

-- CreateEnum
CREATE TYPE "CategoriaTipoOs" AS ENUM ('ocorrencia', 'instalacao');

-- CreateEnum
CREATE TYPE "OsStatus" AS ENUM ('aberta', 'em_deslocamento', 'em_execucao', 'concluida', 'cancelada', 'pendente');

-- CreateTable
CREATE TABLE "provedores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#6366f1',
    "logoUrl" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_configs" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "tipo" "ErpTipo" NOT NULL DEFAULT 'SGP',
    "url" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "tokenCifrado" TEXT NOT NULL,
    "intervaloPollingSegundos" INTEGER NOT NULL DEFAULT 180,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaSyncEm" TIMESTAMP(3),
    "ultimaSyncOk" BOOLEAN,
    "ultimaSyncMensagem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_os" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "sgpCodigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" "CategoriaTipoOs" NOT NULL DEFAULT 'ocorrencia',
    "visivel" BOOLEAN NOT NULL DEFAULT true,
    "slaHoras" INTEGER,

    CONSTRAINT "tipos_os_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tecnicos" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT,
    "sgpTecnicoId" TEXT,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "usuarioId" TEXT,

    CONSTRAINT "tecnicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordens_servico" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "sgpOsId" TEXT NOT NULL,
    "tipoOsId" TEXT,
    "status" "OsStatus" NOT NULL DEFAULT 'aberta',
    "prioridade" INTEGER NOT NULL DEFAULT 2,
    "clienteNome" TEXT,
    "clienteDocumento" TEXT,
    "contratoId" TEXT,
    "protocolo" TEXT,
    "conteudo" TEXT,
    "observacao" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "dataAgendamento" TIMESTAMP(3),
    "tecnicoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordens_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocorrencias" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "sgpNumero" TEXT NOT NULL,
    "tipo" TEXT,
    "status" TEXT,
    "conteudo" TEXT,
    "responsavel" TEXT,
    "contratoId" TEXT,
    "dataCadastro" TIMESTAMP(3),
    "dataAgendamento" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "provedorId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atribuicoes" (
    "id" TEXT NOT NULL,
    "ordemServicoId" TEXT NOT NULL,
    "tecnicoId" TEXT NOT NULL,
    "atribuidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atribuidoPor" TEXT,

    CONSTRAINT "atribuicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "provedorId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "mensagem" TEXT,
    "quantidade" INTEGER,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duracaoMs" INTEGER,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "erp_configs_provedorId_tipo_key" ON "erp_configs"("provedorId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_os_provedorId_sgpCodigo_key" ON "tipos_os"("provedorId", "sgpCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "tecnicos_usuarioId_key" ON "tecnicos"("usuarioId");

-- CreateIndex
CREATE INDEX "ordens_servico_provedorId_status_idx" ON "ordens_servico"("provedorId", "status");

-- CreateIndex
CREATE INDEX "ordens_servico_status_dataAgendamento_idx" ON "ordens_servico"("status", "dataAgendamento");

-- CreateIndex
CREATE UNIQUE INDEX "ordens_servico_provedorId_sgpOsId_key" ON "ordens_servico"("provedorId", "sgpOsId");

-- CreateIndex
CREATE INDEX "ocorrencias_provedorId_status_idx" ON "ocorrencias"("provedorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ocorrencias_provedorId_sgpNumero_key" ON "ocorrencias"("provedorId", "sgpNumero");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "atribuicoes_ordemServicoId_idx" ON "atribuicoes"("ordemServicoId");

-- CreateIndex
CREATE INDEX "atribuicoes_tecnicoId_idx" ON "atribuicoes"("tecnicoId");

-- CreateIndex
CREATE INDEX "sync_logs_provedorId_iniciadoEm_idx" ON "sync_logs"("provedorId", "iniciadoEm");

-- AddForeignKey
ALTER TABLE "erp_configs" ADD CONSTRAINT "erp_configs_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_os" ADD CONSTRAINT "tipos_os_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tecnicos" ADD CONSTRAINT "tecnicos_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tecnicos" ADD CONSTRAINT "tecnicos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tipoOsId_fkey" FOREIGN KEY ("tipoOsId") REFERENCES "tipos_os"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "tecnicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atribuicoes" ADD CONSTRAINT "atribuicoes_ordemServicoId_fkey" FOREIGN KEY ("ordemServicoId") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atribuicoes" ADD CONSTRAINT "atribuicoes_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_provedorId_fkey" FOREIGN KEY ("provedorId") REFERENCES "provedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
