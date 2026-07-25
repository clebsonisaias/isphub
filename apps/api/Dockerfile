# Build de contexto = raiz do monorepo (workspaces npm precisam dos
# package.json de todos os pacotes). Ver .dockerignore na raiz.
FROM node:22-alpine

WORKDIR /repo

COPY . .

RUN npm ci

# Gera o Prisma Client explicitamente — o postinstall automatico do Prisma
# nao roda de forma confiavel dentro do build do Coolify neste monorepo.
RUN npm run prisma:generate -w @isphub/api

RUN npm run build -w @isphub/shared
RUN npm run build -w @isphub/api

WORKDIR /repo/apps/api

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
