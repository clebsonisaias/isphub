# Build de contexto = raiz do monorepo (workspaces npm precisam dos
# package.json de todos os pacotes). Ver .dockerignore na raiz.
FROM node:22-alpine

WORKDIR /repo

# Manifestos ANTES do codigo. Antes era `COPY . .` seguido de `npm ci`: qualquer
# mudanca em qualquer arquivo invalidava a camada e reinstalava TODA a arvore de
# dependencias do zero, em todo deploy. Com os manifestos numa camada propria, o
# `npm ci` so roda de novo quando uma dependencia realmente muda.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/

RUN npm ci

# Schema antes do resto do codigo: o Prisma Client so precisa dele, entao
# mexer em rota/servico nao invalida esta camada.
COPY apps/api/prisma apps/api/prisma
# Gera o Prisma Client explicitamente — o postinstall automatico do Prisma
# nao roda de forma confiavel dentro do build do Coolify neste monorepo.
RUN npm run prisma:generate -w @isphub/api

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @isphub/shared
RUN npm run build -w @isphub/api

# Seeds de teste NAO vao pra imagem de producao. `e2e-seed.js` cria admin e
# gestor com senha fixa (`e2e-senha-123`) e forca `ativo:true`, o que reativaria
# ate uma conta desligada; `seed-tecnico.js` faz o mesmo com `tecnico123`.
# Nenhum dos dois esta no CMD, mas nao ha motivo pra existirem aqui — se alguem
# ganhar execucao de comando no container, viram persistencia de admin pronta.
RUN rm -f apps/api/dist/e2e-seed.js apps/api/dist/seed-tecnico.js

WORKDIR /repo/apps/api

# Nao rodar como root. A imagem node ja traz o usuario `node`; a aplicacao nao
# escreve nada em disco, entao so precisa de leitura no que o build produziu.
USER node

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/server.js"]
