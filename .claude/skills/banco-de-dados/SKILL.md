---
name: banco-de-dados
description: Padrões de banco do ISPhub (Prisma 6 + Postgres) — escopo por provedor aplicado à mão via escopoService, migrações aditivas no padrão YYYYMMDDTHHMMSS_nome aplicadas no boot do contêiner (e o loop P3009), unicidade que sustenta a idempotência do sync, advisory locks da agenda e dos jobs, índices, datas em -03:00 e armadilhas do Prisma. Use ao mexer em apps/api/prisma/, escrever consulta Prisma ou SQL cru, criar modelo com provedorId ou investigar consulta lenta. Junta prisma-patterns, postgres-patterns e database-migrations.
---

> Adaptado de ECC (MIT, Affaan Mustafa) — https://github.com/affaan-m/ECC (skills `prisma-patterns`, `postgres-patterns`, `database-migrations`)

# Banco de dados (Prisma + Postgres)

Mudança em schema/migração é **risco alto** na skill `safe-change`. Revisão: agente `database-reviewer`.

## 1. Escopo por provedor (invariante — CLAUDE.md)
- **Não há filtro automático.** `apps/api/src/lib/prisma.ts` exporta um `PrismaClient` puro. O isolamento entre provedores depende de cada rota usar `apps/api/src/services/escopoService.ts`:
  - listagens: `escopoOsWhere(user, filtro)` (OS), `filtroProvedor(user, pedido)` (agendamento, pré-cadastro…), `escopoVeiculoWhere` (frota);
  - registro único: `podeAcessarOs`, `exigirProvedor`, `exigirAgendamentosNoEscopo`, `podeAcessarVeiculo`;
  - operação sobre todos os provedores: `exigirEscopoTotal`.
- Combine sempre com `AND: [escopo, ...]`: o escopo do técnico é um `OR` no topo e outro `OR` (busca) o apaga em silêncio.
- Filtro fora do escopo vira o sentinela `__nenhum__` (casa com nada), nunca `{}`.
- Modelo novo com dado de provedor: `provedorId` + `@relation(..., onDelete: Cascade)` (ou `SetNull` se houver dado da própria operação, como `Veiculo`/`Rastreador`), índice começando por `provedorId`, e confira a exclusão de provedor (`routes/provedores.ts`, `provedores.delete.test.ts`).
- Exceções documentadas no schema: `Lancamento`/`Recorrencia`/`Parcelamento.provedorId` é **contraparte** financeira (acesso só ADMIN), não partição; `CanalWhatsappConfig`, `SmtpConfig` e a credencial da linha móvel (Brazmovel) são da operação, sem `provedorId`; `RastreadorConfig` tem a coluna, mas hoje é gravado com `provedorId: null`.
- `$queryRaw`: só a template tag (parâmetros), nunca `$queryRawUnsafe` com texto concatenado; filtro de provedor explícito.
- `connect: { id }` com id vindo do cliente: confira antes que o registro está no mesmo escopo.

## 2. Migrações
Nome da pasta: `YYYYMMDDTHHMMSS_nome_em_snake` (ex.: `20261105T120000_gestor_permissoes`), sempre depois da última. As mais antigas (`20260724025943_init`…) usam o formato padrão do Prisma; não renomeie.

Fluxo (local, banco de desenvolvimento do README):
1. Altere `apps/api/prisma/schema.prisma`.
2. Gere sem aplicar: `npm run prisma:migrate -w @isphub/api -- --create-only --name <nome>`.
3. Renomeie a pasta para o padrão com `T` e **leia o `migration.sql`** (o Prisma às vezes inclui `DROP` que você não pediu).
4. Aplique localmente (`npm run prisma:migrate -w @isphub/api`), gere o client (`npm run prisma:generate -w @isphub/api`), rode typecheck e os testes da área.

**Produção aplica sozinha:** o `CMD` de `apps/api/Dockerfile` roda `prisma migrate deploy` antes de subir a API. Migração que falha fica registrada como falha, o Prisma recusa as seguintes (`P3009`) e a API entra em loop de reinício — aconteceu em 01/11/2026 com `20261029T220000_os_avaliacao_cliente`. Por isso:
- **Aditiva:** coluna nova nula ou com `DEFAULT`. Sem `DROP`/`RENAME`/`NOT NULL` sem default em tabela viva.
- **Idempotente/defensiva** quando o dado de produção pode violar a mudança: `IF NOT EXISTS`, limpar duplicatas antes de `@@unique` novo, backfill antes de `NOT NULL`.
- Renomear/remover coluna = expandir → código lê/escreve as duas → migrar dados → contrair em migração posterior, em PRs separados.
- Migração aplicada é imutável (checksum); correção é migração nova.
- Backfill grande fora da migração de schema, em lotes.
- Nunca `prisma migrate reset`/`db push` fora do banco local.

**Índices parciais escritos à mão.** O Prisma não expressa `WHERE` em índice, então várias garantias do banco existem só no SQL da migração, sem nada no `schema.prisma`: uma ocupação aberta por técnico (`ocupacoes_veiculo_uma_aberta_por_usuario`), um motorista aberto por veículo, uma jornada aberta por técnico, um vínculo aberto por rastreador/veículo, uma viagem aberta por veículo, entre outras. Liste com `grep -rn "WHERE \"fimEm\" IS NULL" apps/api/prisma/migrations`. Por isso:
- O `--create-only` e o `prisma migrate diff` **vão propor `DROP INDEX`** desses índices. Apague essas linhas do `migration.sql` gerado: remover é regressão, não limpeza.
- Índice parcial novo: escreva-o à mão no `migration.sql`, com um comentário `⚠️ INDICE PARCIAL — ESCRITO A MAO` explicando o que ele garante, e comente o modelo no `schema.prisma` apontando para ele.

## 3. Idempotência e concorrência
- O sync com o SGP depende de chaves naturais: `OrdemServico @@unique([provedorId, sgpOsId])`, `TipoOs @@unique([provedorId, sgpCodigo])`, `MensagemCliente @@unique([canal, waMessageId])`, `Lancamento @@unique([recorrenciaId, vencimento])`, posições/eventos de rastreador. Não afrouxe; upsert novo precisa de `@@unique` que o sustente (skill `integracao-sgp`).
- `@@unique` com coluna nula não impede duplicata quando o valor é NULL.
- `comTravaExclusiva(chave, fn)` (`src/lib/prisma.ts`): advisory lock de transação, não espera (devolve `null` se ocupado), segura uma conexão do pool durante `fn`. Usado no sync por provedor e nos jobs (`src/jobs/*Scheduler.ts`). Jobs rodam em todo contêiner vivo — no deploy há dois por alguns segundos.
- Agenda: vagas por dia|turno disputadas; ler ocupação e gravar na mesma transação com advisory lock (`agendaService`). Reagendamento solicitado libera a vaga na hora (`docs/skills/isphub-audit/SKILL.md` §3).

## 4. Índices e consultas
- Consulta de painel filtrada por provedor: índice composto começando por `provedorId`, depois igualdade, por fim intervalo/ordenação (ex.: `OrdemServico @@index([provedorId, status])`, `SyncLog @@index([provedorId, iniciadoEm])`).
- FK nova → índice. `@unique` já cria índice.
- Paginação de lista que cresce (timeline, logs, posições de rastreador): cursor ordenando por data **e** `id`, não `skip` grande; `take` sempre.
- Evite N+1 (consulta dentro de `for` por OS).
- `select` explícito em resposta da API: nunca devolva `ErpConfig`, `AtendaiConfig` ou outro modelo com campo `*Cifrado` cru.
- Lento? `EXPLAIN (ANALYZE, BUFFERS)` no banco local com volume parecido.

## 5. Armadilhas do Prisma
- `updateMany`/`deleteMany` devolvem `{ count }`; em trava otimista, `count === 0` = outro processo chegou antes.
- `@updatedAt` não muda em `updateMany`.
- `$transaction(async (tx) => …)`: só `tx` lá dentro; **nada de SGP/HTTP dentro** (timeout de 5 s). O write-back chama o SGP antes e grava depois.
- `Json?`: nulo é `Prisma.DbNull`/`Prisma.JsonNull`; filtro de "qualquer nulo", `Prisma.AnyNull`.
- `deleteMany()` sem `where` apaga a tabela inteira (não há tenant automático para limitar).
- `P2002`/`P2025`/`P2003` traduzidos na borda para `HttpError` (`src/middleware/errorHandler.ts`).

## 6. Tempo
`DateTime` do Prisma (UTC). Dia civil, turnos e "hoje" em `-03:00` fixo (`packages/shared/src/dia.ts`, `agenda.ts`), nunca no fuso do servidor ou do navegador.
