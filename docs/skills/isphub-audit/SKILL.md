---
name: isphub-audit
description: Auditoria técnica especializada da plataforma ISPhub (SaaS de gestão operacional para ISPs, SGP, AtendAI/CityChat, agendamento, roteirização e segurança).
---

# ISPhub Technical Audit Skill

Esta skill define o protocolo rigoroso de auditoria, verificação de conformidade, integridade de dados e resiliência da plataforma **ISPhub**.

## Quando usar esta skill
Use esta skill sempre que:
- Realizar auditoria técnica ou arquitetural no ISPhub.
- Avaliar a integridade da sincronização bidirecional com ERPs (SGP, etc.).
- Verificar segurança de autenticação, JWT, RBAC e isolamento multi-tenant (`provedorId`).
- Analisar a consistência de agendamento de campo, capacidade de turnos e roteirização.
- Avaliar concorrência e condições de corrida (Advisory Locks, transações Prisma).
- Auditar a comunicação via WhatsApp / Webhooks (AtendAI, CityChat, Meta Cloud API).

---

## 1. Funil de Sincronização e Integridade ERP (SGP)

### 1.1 Regras de Ouro
1. **Idempotência Obrigatória:** Qualquer evento ou webhook que chegue repetido não pode duplicar nem desconfigurar registros em `ordem_servico`, `agendamento` ou `agendamento_evento`.
2. **Preservação de Dados de Campo:** O SGP é fonte de verdade para cadastro de cliente, contrato e dados cadastrais da OS; o ISPhub é fonte de verdade para agendamento de campo, turno, técnico alocado, status de execução e check-ins.
3. **Fusos Horários:** O SGP opera em horário local (`America/Fortaleza` / UTC-3). Ao converter datas do SGP sem fuso, aplicar `-03:00` explicitamente antes de armazenar em UTC (evitar o bug de double-offset ou deslocamento de meia-noite).

### 1.2 Verificações Chave
- Conferir se `syncService.ts` e `sgp.ts` tratam falhas de conectividade com fallback gracioso.
- Conferir se OS canceladas no SGP refletem status correto no espelho do ISPhub sem apagar a trilha de agendamento.
- Conferir se `status_id` numérico tem precedência sobre rótulos de texto.

---

## 2. Isolamento Multi-tenant e Segurança

### 2.1 Isolamento de Dados
- **Toda consulta crítica no backend DEVE filtrar por `provedorId`.**
- Nunca confiar apenas em IDs autoincrementais ou UUIDs soltos sem validação de pertencimento ao provedor autenticado no `req.user.provedorId` (exceto para usuários com role global `superadmin`).
- Rotas públicas de webhook (ex.: Meta / CityChat) devem validar assinatura HMAC (`X-Hub-Signature-256`) e segredos de webhook antes do processamento.

### 2.2 Proteção de PII e LGPD
- Logs em produção nunca devem emitir dados sensíveis brutos (senhas, CPFs, tokens de terceiros).
- Variável `SGP_DEBUG_RAW` deve permanecer desligada em produção.
- Chaves simétricas (`CRYPTO_KEY`) devem possuir 64 caracteres hex (32 bytes) para criptografia AES-256-GCM de tokens de provedores.

---

## 3. Concorrência e Regras de Agendamento

### 3.1 Advisory Locks e Transações
- Agendamento concorrente no mesmo turno disputa vagas finitas. Toda operação em `agendaService.marcar` deve utilizar transação com Advisory Lock por janela (`${dia}|${turno}`) para prevenir overbooking.
- Vagas no turno devem considerar equipes corretas: ordens de retirada e parceiros externos (`equipeExterna = true`) não consomem capacidade da equipe interna técnica.

### 3.2 Liberação Imediata de Vaga
- Quando o cliente sinaliza reagendamento (`solicitouReagendamento: true`), a vaga deve ser imediatamente liberada para os cálculos de ocupação (`ocupacoesEntre` e `ocupacoesNaTransacao`), permitindo que novos agendamentos utilizem o turno sem esperar intervenção manual.

### 3.3 Correspondência Precisa de Telefone
- Ao associar respostas de WhatsApp a agendamentos, exigir correspondência de DDD + 9 dígitos ou dígitos nacionais completos. Nunca utilizar matching frouxo por substring de 8 dígitos para evitar colisões entre clientes de regiões distintas.

---

## 4. Checklist Rápido de Verificação de Código

Antes de aprovar ou finalizar mudanças:
1. `npm test -w @isphub/api` (todos os testes unitários passando).
2. `npm test -w @isphub/web` (testes unitários do frontend passando).
3. `npm run build` (build TypeScript e bundling limpos sem warnings críticos).
4. Conferir se migrações Prisma (`prisma migrate`) foram criadas se o schema sofreu alteração.
5. Deploy validado via script de produção com healthcheck `HTTP 200` em `/health`.
