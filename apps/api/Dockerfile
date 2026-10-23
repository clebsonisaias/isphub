# Build de contexto = raiz do monorepo (workspaces npm precisam dos
# package.json de todos os pacotes). Ver .dockerignore na raiz.
FROM node:22.23.4-alpine

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

# tsconfig.base.json e obrigatorio: TODO tsconfig de workspace faz `extends`
# nele. Com o `COPY . .` antigo ele vinha de carona; ao passar a copiar arquivo
# por arquivo (pra ganhar cache de camada) ficou de fora, e o build quebrou com
# `TS5083: Cannot read file '/repo/tsconfig.base.json'`.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @isphub/shared
RUN npm run build -w @isphub/api

# Seeds de teste NAO vao pra imagem de producao. `e2e-seed.js` cria admin e
# gestor com senha fixa (`e2e-senha-123`) e forca `ativo:true`, o que reativaria
# ate uma conta desligada; `seed-tecnico.js` faz o mesmo com `tecnico123`.
# Nenhum dos dois esta no CMD, mas nao ha motivo pra existirem aqui — se alguem
# ganhar execucao de comando no container, viram persistencia de admin pronta.
# `verifica-agenda.js` e `verifica-auto-agenda.js` fazem deleteMany em
# provedores/OS — scripts de banco descartavel, nao tem o que fazer num
# container de producao.
RUN rm -f apps/api/dist/e2e-seed.js apps/api/dist/seed-tecnico.js apps/api/dist/verifica-agenda.js apps/api/dist/verifica-auto-agenda.js

WORKDIR /repo/apps/api

# TODO(seguranca): rodar como usuario `node` em vez de root. Tentei junto com
# esta mudanca e voltei atras — o CMD chama `npx prisma migrate deploy`, e nao
# tenho Docker nesta maquina pra confirmar que o npx nao esbarra em permissao
# de cache/HOME com usuario nao-root. Como um deploy que falha mantem no ar a
# versao COM as vulnerabilidades, nao vale arriscar o ciclo por um
# endurecimento. Fazer depois, validando o build localmente antes.

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/server.js"]
