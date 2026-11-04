# Confirmação de Visita, Roteirização e Técnico a Caminho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar confirmação automática de visita no WhatsApp, botão de otimização de rotas inteligentes por técnico e notificação de técnico a caminho com foto e placa da viatura no ISPhub.

**Architecture:** O Prisma gerencia novos campos de confirmação em `Agendamento` e foto em `Usuario`. Um job agendado (`confirmacaoVisitaScheduler`) dispara as mensagens de confirmação e o webhook do AtendAI registra a resposta do cliente. A roteirização utiliza o algoritmo TSP existente em `logisticaService` acionado por botão no frontend. O evento de início de deslocamento dispara mensagem no WhatsApp com foto do técnico e placa do veículo rastreado.

**Tech Stack:** Node.js, TypeScript, Express, Prisma ORM, React, Tailwind CSS, shadcn/ui, Vitest.

**Spec:** `/Users/clebson/.gemini/antigravity/brain/dfb3446c-bbe2-4063-b11b-86330ff8e21f/design-confirmacao-roteirizacao-tecnico-a-caminho.md`

## Global Constraints
- Manter compatibilidade com banco de dados PostgreSQL existente.
- Preservar integridade dos conectores SGP e AtendAI.
- Não introduzir dependências externas desnecessárias (usar libs já presentes no projeto).
- Respeitar advisory locks e isolamento por provedor (`provedorId`).

## Review Focus
1. Mensagem de confirmação não deve ser enviada para visitas já canceladas ou concluídas.
2. Webhook de resposta do cliente deve ser idempotente (ignorar respostas duplicadas).
3. Otimização de rota não deve quebrar quando faltar coordenada geográfica de um cliente (manter na posição atual).
4. Técnico a caminho deve enviar mensagem legível mesmo se técnico não tiver foto ou viatura vinculada (fallback gracioso).
5. Botão de aplicar rota deve atualizar a grade em tempo real via WebSocket/SSE.

---

### Task 1: Schema do Prisma & Migração
**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/prisma/schema.prisma`

- [ ] Adicionar campos em `Agendamento`: `confirmadoCliente Boolean @default(false)`, `confirmadoClienteEm DateTime?`, `solicitouReagendamento Boolean @default(false)`.
- [ ] Adicionar campo em `Usuario`: `fotoUrl String?`.
- [ ] Executar `npx prisma generate` em `apps/api`.
- [ ] Criar migração SQL correspondente em `apps/api/prisma/migrations/`.
- [ ] Commit das alterações do schema.

### Task 2: Confirmação Automática de Visita (Serviço & Webhook)
**Files:**
- Create: `apps/api/src/services/confirmacaoVisitaService.ts`
- Create: `apps/api/src/services/confirmacaoVisitaService.test.ts`
- Create: `apps/api/src/jobs/confirmacaoVisitaScheduler.ts`
- Modify: `apps/api/src/routes/atendaiChatWebhook.ts`
- Modify: `apps/api/src/server.ts`

- [ ] Escrever teste unitário para `confirmacaoVisitaService.test.ts` (busca de visitas, template de mensagem, parser de respostas "1/Sim" e "2/Reagendar").
- [ ] Implementar `confirmacaoVisitaService.ts` com busca de agendamentos e disparo via `clienteAtendaiService`.
- [ ] Conectar processamento de resposta no `atendaiChatWebhook.ts` atualizando `confirmadoCliente` ou `solicitouReagendamento`.
- [ ] Implementar `confirmacaoVisitaScheduler.ts` rodando cron diário (18:00 e 07:15).
- [ ] Conectar scheduler no `server.ts`.
- [ ] Rodar testes unitários e garantir que passaram.
- [ ] Commit da funcionalidade de confirmação de visita.

### Task 3: Técnico a Caminho com Foto e Viatura
**Files:**
- Modify: `apps/api/src/services/clienteAtendaiService.ts`
- Create: `apps/api/src/services/tecnicoACaminho.test.ts`

- [ ] Escrever teste para envio de "técnico a caminho" em `tecnicoACaminho.test.ts` validando texto com nome, foto e placa do veículo.
- [ ] Atualizar `avisarClienteACaminho` em `clienteAtendaiService.ts` para buscar `fotoUrl` do técnico e veículo/placa atual do rastreador (`rastreadorDoVeiculoEm`).
- [ ] Formatar o texto com nome do técnico, placa do veículo e link da foto/crachá de segurança.
- [ ] Rodar os testes unitários.
- [ ] Commit do aviso de técnico a caminho aprimorado.

### Task 4: Roteirização Inteligente - Integração no Painel Web
**Files:**
- Modify: `apps/web/src/lib/logisticaApi.ts` (ou criar)
- Modify: `apps/web/src/pages/PainelPage.tsx` ou componente de Despacho
- Create: `apps/web/src/components/logistica/ModalOtimizarRota.tsx`

- [ ] Criar client de API `apps/web/src/lib/logisticaApi.ts` para chamar `GET /logistica/tecnico/:id/rota-otimizada` e `POST /logistica/tecnico/:id/aplicar-rota`.
- [ ] Criar componente `ModalOtimizarRota.tsx` mostrando comparação entre rota atual e rota sugerida, km e minutos salvos, e botão de aplicar.
- [ ] Adicionar botão "Otimizar Rota" nos cards de técnicos da tela de Despacho/Quadro.
- [ ] Testar fluxo no navegador / build do frontend.
- [ ] Commit da integração de roteirização no frontend.

### Task 5: Verificação Completa e Build
**Files:**
- All changed files

- [ ] Executar suíte completa de testes no backend (`npm test` no workspace `@isphub/api`).
- [ ] Executar typecheck e build (`npm run build` na raiz do projeto).
- [ ] Confirmar ausência de erros e regressões.
- [ ] Commit final e documentação.
