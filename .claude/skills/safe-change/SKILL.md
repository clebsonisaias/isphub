---
name: safe-change
description: SAFE CHANGE WORKFLOW contra regressões no ISPhub. Use em TODA tarefa que altere código, configuração, banco, integração com o SGP, app mobile ou infraestrutura (nova funcionalidade, correção, ajuste). Define escopo mínimo, classificação de risco, checkpoint Git, testes e relatório final. Não use para perguntas sem alteração de arquivos.
---

# SAFE CHANGE WORKFLOW

**Regra fundamental:** altere só o necessário para o pedido. Não modifique funcionalidades, componentes, configurações, APIs ou arquivos que a tarefa não exige. Preserve o comportamento existente, salvo mudança pedida explicitamente. O ISPhub está em uso por provedores e técnicos em campo: regressão aqui é OS que some da fila, técnico parado na porta do cliente ou dado errado no SGP do provedor.

Proporcional: tarefa de baixo risco percorre o fluxo em poucas linhas, sem cerimônia. Não releia arquivos já no contexto; não lance agentes para tarefa simples.

```
ANALYZE → SCOPE → RISK → CHECKPOINT → IMPLEMENT → TEST → REGRESSION REVIEW → FINAL REPORT
```

## 1. ANALYZE
Entenda o pedido. Localize, com busca direcionada, os arquivos envolvidos, como a funcionalidade atual funciona, quem a chama e se já existe algo equivalente (em `apps/api/src/lib`, `services`, `packages/shared`, `apps/web/src/components`). Os comentários do código explicam muitas decisões ("por que assim"): leia antes de "simplificar".

## 2. SCOPE
Liste o menor conjunto de arquivos e mudanças que resolve. Tudo fora dessa lista está fora do escopo. Se precisar sair dele, **explique o motivo antes**.

## 3. RISK
| Nível | Exemplos no ISPhub | O que fazer |
|---|---|---|
| **Baixo** | texto, estilo, mudança localizada em 1 arquivo sem regra de negócio | Siga direto. |
| **Médio** | componente/serviço compartilhado, tipo do `@isphub/shared`, fluxo de agenda, tela da fila | Verifique todos os chamadores (Grep em api, web e mobile) e rode os testes da área. |
| **Alto** | `schema.prisma`/migração (aplicada no boot), `escopoService`/`middleware/auth.ts`/papéis, sync/write-back com o SGP, `connector.ts`, `crypto.ts`/credenciais, webhooks, jobs em `src/jobs/`, `Dockerfile`/CI, `app.json`/`eas.json`/`capacitor.config.ts`, remover funcionalidade | Análise de impacto explícita, plano curto com os riscos e **confirmação do usuário antes** de passo destrutivo ou irreversível. Rode o agente revisor correspondente no fim. |

## 4. CHECKPOINT
- `git status` antes de começar: alterações que já existiam são do usuário. Não sobrescreva, não reverta, não inclua no seu commit sem perguntar.
- Trabalhe numa branch a partir da `main` (CLAUDE.md); não faça commit direto na `main` sem pedido.
- Antes de tarefa de **alto risco**, registre um ponto de volta sem mexer na árvore (ex.: `git stash create` guarda o hash, ou um commit na sua branch).
- Proibido sem autorização explícita: `git reset --hard`, `git clean -f`, `git checkout -- .`, `git restore .`, `git push --force`, `git branch -D`, `git stash drop`, `prisma migrate reset`, `eas update`/`eas submit`.

## 5. IMPLEMENT
Mudanças pequenas e controladas, com Edit localizado. Evite:
- reescrever arquivo ou componente inteiro quando um trecho resolve;
- refatorar código que funciona, renomear, reformatar ou "aproveitar para melhorar";
- trocar biblioteca, versão ou configuração por preferência; instalar dependência sem necessidade (no mobile, dependência nativa exige novo binário);
- alterar contrato de API (o app instalado nos celulares pode estar em versão antiga), schema, papéis/escopo, integração com o SGP ou layout que não foram pedidos;
- excluir código ou arquivo sem necessidade;
- mudar silenciosamente outra funcionalidade para facilitar a implementação.

## 6. TEST
- Rode primeiro o teste do que mudou; depois a verificação completa (skill `ciclo-de-verificacao`).
- Adicione teste para o comportamento novo (vitest ao lado do código). Mudança de escopo: caso com usuário de outro provedor.
- Se não houver teste automático (telas do app mobile), diga isso e o que conferir no aparelho. **Nunca diga que testou o que não testou.**

## 7. REGRESSION REVIEW
1. `git diff` e `git status` contra o início: cada arquivo está no escopo? Desfaça só o que **você** mudou fora do escopo.
2. Efeitos colaterais: chamadores (api, web e mobile usam o mesmo shared), valores padrão, tipos, migrações, textos/rotas usados em outro lugar, versão antiga do app ainda chamando a API.
3. Funcionalidades vizinhas continuam funcionando (testes da área, e2e ou execução manual quando for UI).
4. Achou regressão: corrija preservando o restante do trabalho.

## 8. FINAL REPORT (curto)
- O que foi feito (resultado primeiro).
- Arquivos modificados e por quê; qualquer alteração fora do escopo, com o motivo.
- Testes/verificações executados e o resultado real (ou "não há testes para isto").
- Riscos ou pendências (migração no próximo deploy, novo build do app, confirmação no SGP real).
