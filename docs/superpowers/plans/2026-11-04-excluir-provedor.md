# Plano de Implementação: Exclusão Segura de Provedor no ISPhub

> **Objetivo:** Adicionar funcionalidade completa e segura para exclusão de provedores de internet (com proteção contra cliques acidentais via confirmação por nome), tanto na tela de listagem quanto na página de detalhes do provedor.

---

## 1. Arquitetura e Decisões Técnicas

1. **Integridade de Banco de Dados:**
   - O schema do banco PostgreSQL já possui chaves estrangeiras com `ON DELETE CASCADE` para entidades exclusivas do provedor (`ordens_servico`, `agendamentos`, `erp_configs`, `atendai_configs`, `tecnicos_sgp`, `chaves_parceiro`) e `ON DELETE SET NULL` para entidades compartilhadas (`usuarios`, `veiculos`, `lancamentos`).
   - O endpoint `DELETE /provedores/:id` na API deve emitir notificação realtime `config-alterada` para sincronizar os navegadores.

2. **UX Segura e Acessível (Modal Destrutivo):**
   - Criação do componente `ExcluirProvedorDialog.tsx` usando Radix/shadcn `Dialog`.
   - Exige que o usuário digite o nome exato do provedor antes de habilitar o botão de confirmação ("Excluir definitivamente"), prevenindo qualquer perda acidental de dados operacionais.
   - Estado de carregamento com spinner durante a requisição.
   - Ao excluir a partir da página de detalhes (`ProvedorDetailPage`), redirecionar automaticamente para `/admin` com notificação de sucesso via Toast.

3. **Arquivos Envolvidos:**
   - Backend:
     - `apps/api/src/routes/provedores.ts` (ajuste e emissão de realtime)
     - `apps/api/src/routes/provedores.test.ts` (testes de exclusão)
   - Frontend:
     - `apps/web/src/components/admin/ExcluirProvedorDialog.tsx` (novo componente de diálogo)
     - `apps/web/src/pages/admin/ProvedoresPage.tsx` (botão de lixeira nos cards)
     - `apps/web/src/pages/admin/ProvedorDetailPage.tsx` (botão de exclusão no cabeçalho)

---

## 2. Tarefas de Execução

- [ ] **Task 1: Backend - Ajuste da rota DELETE e Emissão Realtime**
  - Adicionar emissão de evento realtime `config-alterada` após exclusão.
  - Criar testes unitários para a rota `DELETE /provedores/:id`.
  - Executar testes com `npx vitest run apps/api/src/routes/provedores.test.ts`.

- [ ] **Task 2: Frontend - Componente ExcluirProvedorDialog**
  - Implementar modal com confirmação por digitação de nome.
  - Validação de segurança, estados de loading e toast de feedback.

- [ ] **Task 3: Frontend - Integração na Listagem e Detalhes**
  - Inserir botão de exclusão nos cards de `ProvedoresPage.tsx`.
  - Inserir botão de exclusão no cabeçalho de `ProvedorDetailPage.tsx` com navegação pós-exclusão.

- [ ] **Task 4: Verificação, Build e Deploy**
  - Rodar suíte de testes unitários do backend e frontend.
  - Rodar build completo do monorepo (`npm run build`).
  - Deploy em produção via script Coolify.
