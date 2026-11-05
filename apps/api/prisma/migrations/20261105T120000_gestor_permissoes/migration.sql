-- Supervisor (GESTOR) limitado por provedor e por area. Aditiva: os defaults
-- (lista vazia e permissoes nulas) mantem os gestores atuais exatamente como estao.
ALTER TABLE "usuarios" ADD COLUMN "provedoresPermitidos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "usuarios" ADD COLUMN "permissoes" JSONB;
