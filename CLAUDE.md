# ISPhub

Plataforma de terceirização de campo para provedores de internet: fila única de OS/ocorrências de vários provedores, cada um com o próprio SGP, com sincronização bidirecional (o ISPhub escreve de volta no SGP do provedor). Monorepo npm workspaces, Node 22 no CI (README pede ≥ 20), TypeScript.

| Pasta | O que é |
|---|---|
| `apps/api` | Express + Prisma (Postgres), node-cron (`src/jobs/`), conectores em `src/connectors/` (SGP e outros), testes vitest ao lado do código (`src/**/*.test.ts`) |
| `apps/web` | Painel React 19 + Vite + Tailwind 4 + shadcn/ui; também empacotado com Capacitor (Android); vitest e Playwright (`e2e/`) |
| `apps/mobile` | App do técnico/vendedor em Expo/React Native (Expo Router, fila offline, push Expo, GPS, EAS Build/Update) |
| `packages/shared` | Tipos, enums, regras de papel/status e o contrato `ErpConnector` (`@isphub/shared`) |

## Comandos

- Build do shared (antes de typecheck/teste dos outros): `npm run build:shared`
- Prisma Client (antes do typecheck da API): `npm run prisma:generate -w @isphub/api`
- Typecheck: `npm run typecheck -w @isphub/api` (ou `-w @isphub/web`, `-w @isphub/mobile`); todos: `npm run typecheck`
- Testes: `npm test -w @isphub/api` (um arquivo: `cd apps/api && npx vitest run src/services/<nome>.test.ts`), `npm test -w @isphub/web`, `npm test -w @isphub/mobile`. Os da API mockam `../lib/prisma.js` e não precisam de Postgres.
- Lint do web: `npm run lint -w @isphub/web` (oxlint)
- E2E: `cd apps/web && npx playwright test` (sobe API, web e o SGP falso da porta 4569; precisa do Postgres de dev)
- Verificação completa (o mesmo que o CI em `.github/workflows/ci.yml`): `npm run build:shared && npm run prisma:generate -w @isphub/api && npm run typecheck && npm test -w @isphub/api && npm test -w @isphub/mobile && npm run lint -w @isphub/web && npm run build`

## Branches e publicação

- Só existe a `main`. O CI roda em todo push e PR. A API e o web vão para o Coolify (`apps/api/Dockerfile`, `apps/web/Dockerfile`); de qual branch o Coolify publica: **a confirmar** (presume-se a `main`).
- Trabalho novo em branch própria a partir da `main`, de volta por pull request.
- O contêiner da API roda `prisma migrate deploy` ao subir: migração que falha derruba a API em loop (já aconteceu, ver o `CMD` do Dockerfile).
- App mobile: binário por EAS Build e JS por EAS Update (canais `development`/`preview`/`production` em `apps/mobile/eas.json`). `eas update` no canal `production` chega aos técnicos na hora; não publique sem pedido explícito.

## Regras globais

- Nomes de código, mensagens de commit e textos em português, seguindo o estilo existente. Commits no formato `feat(escopo):`, `fix(escopo):`, `chore:`.
- **Dados de um provedor nunca vazam para outro.** Não há filtro automático no Prisma: o escopo é aplicado à mão em cada rota com `apps/api/src/services/escopoService.ts` (`escopoOsWhere`, `filtroProvedor`, `podeAcessarOs`, `exigirProvedor`…). PROVEDOR/ATENDENTE/VENDEDOR veem só o próprio provedor; TÉCNICO só as OS em que trabalha (responsável ou apoio); GESTOR pode ter lista de provedores. Toda consulta ou rota nova precisa aplicar o escopo; papel novo de atendente/vendedor fica negado por padrão em `middleware/auth.ts`.
- Credenciais de terceiros (token do SGP em `ErpConfig.tokenCifrado`, AtendAI, WhatsApp, SMTP, rastreador) ficam cifradas com AES-256-GCM (`apps/api/src/lib/crypto.ts`), só são decifradas em memória e saem mascaradas (`maskToken`) ou nem saem. Nunca logue URL completa do SGP (leva `token` na query).
- Nunca versione segredos (`.env*`, chaves do EAS/lojas) nem exponha dados pessoais de clientes (nome, CPF/CNPJ, telefone, endereço, fotos) em logs, testes ou respostas. `SGP_DEBUG_RAW` fica desligado.
- Sincronização com o SGP: escrita primeiro no SGP, depois no espelho; upsert idempotente; lista incompleta nunca é tratada como "OS sumiu". Detalhes na skill `integracao-sgp`.
- Toda alteração segue a skill `safe-change`: escopo mínimo, preservar o que funciona, risco classificado, testes e relatório final honesto. Antes de dizer "pronto", a skill `ciclo-de-verificacao`. Trabalhe com a skill `token-efficient-development`.
- Agentes de revisão (somente leitura) ficam em `.claude/agents/`. Antes de concluir mudança em banco, segurança/escopo, sincronização/jobs/integrações, painel ou app, rode o revisor correspondente: `database-reviewer`, `security-reviewer`, `silent-failure-hunter`, `typescript-reviewer`, `react-reviewer`, `mobile-reviewer`, `pr-test-analyzer`; `test-runner` roda suítes e resume as falhas.
- Regras específicas de cada app ficam em `.claude/rules/` e só carregam quando arquivos daquela pasta são abertos. A auditoria ampla da plataforma está em `docs/skills/isphub-audit/SKILL.md`.
