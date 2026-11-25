---
name: token-efficient-development
description: Regras para trabalhar no repositório ISPhub gastando menos contexto e tokens sem perder qualidade. Use no início de qualquer tarefa de código (investigar, corrigir, implementar, revisar, rodar testes) e quando a sessão ficar longa.
---

# Desenvolvimento econômico em tokens

Objetivo: chegar ao mesmo resultado com menos leitura, menos repetição e menos texto. Qualidade, segurança e requisitos vêm antes da economia, sempre.

## 1. Contexto: leia só o que a tarefa pede

- Comece por busca direcionada (Grep/Glob por símbolo, rota, mensagem de erro). Só depois abra arquivos, e só os que a busca apontou.
- Arquivos grandes do projeto: `apps/api/prisma/schema.prisma` (~2.500 linhas), `apps/api/src/connectors/sgp.ts`, `services/syncService.ts`, `services/writebackService.ts`, `services/agendaService.ts`. Leia o trecho (`offset`/`limit`, ou busque `^model Nome` / nome da função com `-C`), não o arquivo inteiro.
- Não releia um arquivo que já está no contexto e não mudou. Depois de um Edit bem-sucedido, não releia para "conferir".
- Não refaça buscas que já deram resposta nesta sessão. Anote o achado (arquivo:linha) e reutilize.
- Não abra `docs/` (planos em `docs/superpowers/`, `openapi.yaml`, `app-lojas.md`) a menos que a tarefa seja sobre o assunto.
- Ignore `node_modules/`, `dist/`, `build/`, `apps/web/android/`, `test-results/`, `playwright-report/`, `graphify-out/` e `package-lock.json`, salvo pedido explícito.
- Restrinja buscas ao workspace afetado (`apps/api`, `apps/web`, `apps/mobile`, `packages/shared`). Mudança no shared é a exceção: procure o uso nos três.

## 2. Quando delegar para subagente

Delegue quando o trabalho produziria muita saída que você não precisa ver inteira:

- Varredura ampla ("onde isso é usado no monorepo?") → agente `Explore`, pedindo só conclusões e `arquivo:linha`.
- Rodar suítes/typecheck/build e resumir falhas → agente `test-runner`.
- Revisão especializada → os revisores de `.claude/agents/` (listados no CLAUDE.md).

Não delegue: leitura de 1–3 arquivos conhecidos, uma busca simples, ou algo que você já investigou. Não lance dois agentes para a mesma pergunta. Peça sempre resposta curta (conclusão + arquivos + próximos passos).

## 3. Testes e comandos

- Rode o teste do arquivo que você mudou antes da suíte: `cd apps/api && npx vitest run src/<caminho>.test.ts`.
- Typecheck do workspace afetado (`npm run typecheck -w @isphub/<api|web|mobile>`) durante a iteração; o completo uma vez antes de concluir.
- Filtre saídas longas (`| tail -40`, `grep -E "FAIL|Error"`) quando só o resultado importa.
- Não repita o mesmo comando esperando outro resultado. Se falhou, leia o erro e mude algo.
- Agrupe chamadas independentes na mesma resposta.

## 4. Mudanças de código

- Investigue antes de editar: identifique os arquivos e chamadores afetados.
- Faça a menor mudança que resolve. Não crie abstração para um único uso, não duplique helper que já existe (procure em `apps/api/src/lib/`, `services/`, `packages/shared/src/` antes).
- Não toque em arquivos fora do escopo da tarefa.
- Não gere documentação, comentários longos ou arquivos de resumo que ninguém pediu.

## 5. Respostas

- Durante o trabalho rotineiro: uma linha por etapa relevante, sem narrar cada ferramenta.
- No final: resultado primeiro, depois o essencial (arquivos alterados, como verificar, riscos).
- Não cole de volta código ou saídas que o usuário não precisa ler.

## 6. Higiene da sessão

- Tarefa nova sem relação com a anterior → sugira `/clear` (ou uma sessão nova).
- Sessão longa que precisa continuar → sugira `/compact <o que preservar>`.
- `/context` mostra o que está ocupando a janela.

## 7. Uso proporcional de skills de processo

Skills de processo do superpowers (brainstorming, writing-plans, subagent-driven-development, executing-plans, TDD) custam milhares de tokens e podem lançar vários subagentes. Os planos e especificações delas ficam em `docs/superpowers/`. Use-as em funcionalidade nova, refatoração de vários arquivos ou bug difícil. Em correção pontual, ajuste de texto, pergunta sobre o código ou mudança de poucas linhas, trabalhe direto. `systematic-debugging` e `verification-before-completion` continuam valendo sempre que se aplicarem.

## O que a economia nunca justifica

Código inseguro; pular teste ou validação relevante; ignorar erro, aviso ou requisito; remover funcionalidade; entregar pela metade; mexer em arquivo não relacionado. Problema complexo (escopo por provedor, sync/write-back com o SGP, concorrência na agenda, migração, offline do app) recebe análise completa, quanto custar.
