-- Novo tipo de evento na timeline: "edicao" (ex.: descricao/conteudo da OS
-- reescrito por acao humana no ISPhub, com write-back pro SGP).

-- AlterEnum
ALTER TYPE "OsEventoTipo" ADD VALUE 'edicao';
