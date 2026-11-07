---
paths:
  - "apps/api/**"
---
# API (apps/api)

- Rotas em `src/routes/` (montadas em `src/app.ts`), regra de negócio em `src/services/`, jobs node-cron em `src/jobs/`, conectores externos em `src/connectors/`. Rota async com `asyncHandler`; erro HTTP com `HttpError` (`src/middleware/errorHandler.ts`); entrada validada com zod.
- Escopo por provedor é manual: toda consulta/ação de rota usa `src/services/escopoService.ts` (`escopoOsWhere`, `filtroProvedor`, `podeAcessarOs`, `exigirProvedor`…). Rota nova para ATENDENTE/VENDEDOR precisa entrar na lista de `src/middleware/auth.ts` (negação por padrão).
- Credenciais de terceiros cifradas com `src/lib/crypto.ts`; resposta mascara com `maskToken`. URL configurável por admin passa por `validarUrlExterna`. Nunca logue URL do SGP inteira (leva `token`), CPF, telefone ou endereço.
- Variáveis de ambiente só via `src/config/env.ts` (zod; flag booleana estrita).
- SGP: escrita primeiro no SGP, depois no espelho; sync idempotente e serializado por provedor. Ver skill `integracao-sgp`.
- Prisma: altere `prisma/schema.prisma`, gere com `npm run prisma:migrate -w @isphub/api -- --create-only --name <nome>`, renomeie para `YYYYMMDDTHHMMSS_nome` e revise o SQL — apague qualquer `DROP INDEX` de índice parcial escrito à mão (ver skill `banco-de-dados`). Não edite migração aplicada. Produção roda `migrate deploy` no boot. Ver skill `banco-de-dados`.
- Testes ao lado do código (`src/**/*.test.ts`), Prisma mockado, sem Postgres: `npx vitest run src/<caminho>.test.ts`. Se mudar `packages/shared`, rode `npm run build:shared` antes.
