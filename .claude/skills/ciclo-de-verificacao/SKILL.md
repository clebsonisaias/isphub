---
name: ciclo-de-verificacao
description: Ciclo de verificação do ISPhub antes de dizer "pronto" ou abrir PR — build do shared, Prisma Client, typecheck, teste focado e depois as suítes (API, mobile, web), lint do web, build, e2e quando o fluxo de despacho/SGP mudou, varredura de segredos e dados pessoais no diff, e revisão do diff com os agentes. Alimenta as etapas TEST/REGRESSION REVIEW/FINAL REPORT da skill safe-change (não a substitui). Use ao terminar uma mudança de código ou antes de abrir/atualizar PR.
---

> Adaptado de ECC (MIT, Affaan Mustafa) — https://github.com/affaan-m/ECC (skill `verification-loop`)

# Ciclo de verificação

O processo (escopo, risco, relatório) é o da skill `safe-change`. Esta skill só diz **quais comandos** rodar aqui e **como relatar**. Para suíte longa, delegue ao agente `test-runner`. O CI (`.github/workflows/ci.yml`) roda os passos 1–5 em todo push; rodar antes evita PR vermelho.

Use `set -o pipefail` quando filtrar saída com `| tail`, para não mascarar a falha.

## 1. Preparação
```bash
npm run build:shared                       # se packages/shared mudou (os outros importam o dist/)
npm run prisma:generate -w @isphub/api     # se o schema mudou ou é um clone novo
```

## 2. Typecheck do que mudou
```bash
npm run typecheck -w @isphub/api           # ou @isphub/web, @isphub/mobile, @isphub/shared
```
O tsconfig da API inclui os `*.test.ts`. Mudança no shared: rode o typecheck de todos (`npm run typecheck`), porque api, web e mobile consomem o mesmo tipo.

## 3. Testes — focado primeiro, depois a suíte
```bash
cd apps/api && npx vitest run src/services/<arquivo>.test.ts   # o que você mexeu
npm test -w @isphub/api
npm test -w @isphub/mobile
npm test -w @isphub/web                                         # o CI não roda este; rode se mexeu no web
```
Não precisam de Postgres (Prisma mockado). Lembre que mock não prova o `where` real: mudança de escopo por provedor pede assert do `where` e, se possível, o e2e.

## 4. Lint e build
```bash
npm run lint -w @isphub/web
npm run build                                                   # shared -> api -> web
```
O app mobile não tem build no CI; mudança nativa (dependência, plugin, permissão, `app.json`) muda o fingerprint e exige EAS Build — avise, não rode `eas`.

## 5. E2E (quando mudou despacho, status, agenda, login por papel ou o conector SGP)
```bash
cd apps/web && npx playwright test e2e/<area>.spec.ts
```
Precisa do Postgres de dev e do `.env` da API (README). Sobe o SGP falso na porta 4569. Sem banco: diga "e2e não rodado (sem Postgres)" — **nunca** diga que passou.

## 6. Varredura do diff (segredos e dados pessoais)
Regra do CLAUDE.md: nada de `.env*`, chave do EAS/lojas, token de SGP/AtendAI/WhatsApp ou dado pessoal de cliente em código, teste, fixture ou log.
```bash
git diff --name-only origin/main...HEAD | grep -E '(^|/)\.env($|\.)|\.p8$|\.jks$|\.keystore$|service-account.*\.json$' && echo "ARQUIVO PROIBIDO"
git diff origin/main...HEAD | grep -nE '^\+.*(ghp_|AKIA[0-9A-Z]{16}|BEGIN (RSA|EC|OPENSSH) PRIVATE|ExponentPushToken\[|isk_[A-Za-z0-9]{8,}|(token|senha|password|secret)\s*[:=]\s*["'\''][^"'\'']{8,})'
git diff origin/main...HEAD | grep -nE '^\+.*\b[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}\b'     # CPF formatado
git diff origin/main...HEAD -- 'apps/api/src/**' | grep -nE '^\+.*console\.(log|info|warn|error)'
```
Para cada acerto: é valor fictício claramente marcado (`vitest.config.ts`, `mock-sgp-server.mjs`, `.env.example`) ou dado real? `console.*` novo não pode levar URL do SGP com `token`, CPF, telefone ou endereço.

## 7. Revisão do diff
```bash
git status && git diff --stat origin/main...HEAD
```
Cada arquivo está no escopo do pedido? (safe-change §7). Área sensível → agente revisor em `.claude/agents/`:
- schema, migração, consulta → `database-reviewer`
- rota, papel, escopo por provedor, webhook, credencial, evidência → `security-reviewer`
- sync/write-back SGP, job, push, outbox → `silent-failure-hunter`
- `.ts` relevante → `typescript-reviewer`; `.tsx` do painel → `react-reviewer`; `apps/mobile` → `mobile-reviewer`
- lógica nova sem teste claro → `pr-test-analyzer`

## 8. Relatório (entra no FINAL REPORT da safe-change)
```
VERIFICAÇÃO
Shared/Prisma: ok | não se aplica
Typecheck:     ok | falhou (N erros) — workspaces: …
Testes:        api X/Y; mobile X/Y; web X/Y | não rodados (motivo)
Lint/Build:    ok | falhou | não se aplica
E2E:           <spec>: ok | não rodado (motivo) | não se aplica
Varredura:     limpa | N itens (explicados)
Diff:          N arquivos, todos no escopo | fora do escopo: … (motivo)
Revisores:     <agente>: <veredito> | não usados
Produção:      não verificado (publicação: a confirmar no Coolify; app por EAS)
Pronto para PR: sim | não — pendências: …
```
Verificação local verde não prova produção. Não acesse produção, não rode migração em banco remoto, não publique (`eas update`, deploy) sem pedido explícito.
