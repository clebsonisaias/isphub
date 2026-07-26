-- Remove a coluna criada pra proteger a edicao de descricao da OS: a API do
-- SGP nao expoe escrita nesse campo (confirmado ao vivo — o endpoint de
-- update aceita "os_conteudo" com HTTP 200 e nenhum erro, mas ignora o campo
-- silenciosamente). Sem edicao local, nao ha o que proteger.

-- AlterTable
ALTER TABLE "ordens_servico" DROP COLUMN "conteudoAlteradoEm";
