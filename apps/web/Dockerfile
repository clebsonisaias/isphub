# Build de contexto = raiz do monorepo (workspaces npm). Ver .dockerignore.
FROM node:22-alpine AS build

WORKDIR /repo
COPY . .

# VITE_API_URL e lido em build-time pelo Vite (import.meta.env) — precisa
# ser passado como build arg pelo Coolify, apontando pra URL publica da API.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm ci
RUN npm run build -w @isphub/shared
RUN npm run build -w @isphub/web

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /repo/apps/web/dist ./dist

EXPOSE 80

CMD ["serve", "-s", "dist", "-l", "80"]
