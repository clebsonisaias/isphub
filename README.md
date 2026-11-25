# ISPhub

Plataforma independente de terceirização de campo para provedores de internet.
Centraliza numa fila única as ordens de serviço e ocorrências de vários
provedores (cada um com seu próprio ERP — hoje: **SGP**), com sincronização
bidirecional: toda ação no ISPhub é refletida de volta no SGP do provedor.

100% independente de qualquer outro sistema — não compartilha código, banco
ou infraestrutura com nada além do que está neste repositório.

Design/arquitetura completos: `docs/` (a definir) — plano original em
`/Users/clebson/.claude/plans/inherited-bouncing-spark.md`.

## Estrutura

```
isphub/
  apps/
    api/     Node + TypeScript + Express + Prisma — backend/hub
    web/     React + Vite + Tailwind + shadcn/ui — Admin, Painel, Mapa, Dashboard
  packages/
    shared/  Tipos, enums e o contrato ErpConnector compartilhados
```

## Pré-requisitos

- Node.js 22+ (o mesmo do CI e das imagens Docker)
- PostgreSQL 16 (local via Homebrew ou remoto)

## Setup local

```bash
# 1. Instalar dependências (na raiz)
npm install

# 2. Criar role e banco no Postgres local (ajuste usuário/senha se preciso)
psql -d postgres -c "CREATE ROLE isphub LOGIN PASSWORD 'isphub_dev_local' CREATEDB;"
psql -d postgres -c "CREATE DATABASE isphub OWNER isphub;"

# 3. Configurar variáveis de ambiente da API
cp apps/api/.env.example apps/api/.env
# Preencha DATABASE_URL, JWT_SECRET e CRYPTO_KEY (gere com o comando abaixo)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Rodar as migrations e gerar o client do Prisma
npm run prisma:generate -w @isphub/api
npm --workspace @isphub/api exec -- prisma migrate deploy

# 5. Compilar o pacote compartilhado (necessário antes de rodar a API/web)
npm run build:shared

# 6. Criar o primeiro usuário admin (a senha é impressa uma única vez)
npm run seed -w @isphub/api
```

## Rodando em desenvolvimento

Em dois terminais:

```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:5173
```

Faça login com o e-mail/senha impressos pelo `npm run seed`.

## Testes

**Unidade (Vitest — conector SGP, SLA, criptografia, mapeamento de status):**

```bash
npm run test -w @isphub/api
```

**End-to-end (Playwright — login por papel, cadastro de provedor, fluxo
despacho→status):** sobe API + web + um SGP fixture dedicado (porta 4569) e
semeia dados determinísticos automaticamente.

```bash
cd apps/web
npx playwright test
```

## Build de produção

```bash
npm run build       # shared -> api -> web
npm run typecheck    # typecheck de todos os pacotes
```

## Deploy

Hospedado no Coolify (`https://coolify.citmax.com.br`), projeto **ISPhub**
separado de qualquer outro projeto — banco de dados e variáveis de ambiente
próprios. Publica a partir da branch `main`. API em `https://api.isphub.net.br`
(é o endereço que o app mobile usa, ver `apps/mobile/eas.json`).

## Fases

- **Fase 1 (atual):** painel web — Admin, Painel Unificado, Mapa, Dashboard.
- **Fase 2:** app nativo do técnico (React Native/Expo) — checklist, fotos,
  assinatura, GPS, fila offline.
- **Fase 3:** portal do provedor (cada provedor acompanha só as próprias OS).
