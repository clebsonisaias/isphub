# ISPhub × AtendAI — Conversas com Clientes por Provedor, e Chat Interno Federado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** (1) o técnico fala com o cliente **da OS atribuída a ele**, por qualquer provedor, com o nome do provedor visível na conversa; (2) o chat interno do ISPhub fala com o chat interno do AtendAI dos provedores que usam as duas plataformas.

**Duas repos:** `isphub` e `atendehub` (produto = **AtendAI**). A maior parte do trabalho é no ISPhub; a demanda 1 exige uma adição no AtendAI.

---

## O que o estudo achou (e por que muda o plano)

### 1. A federação do chat interno já tem servidor. Falta o cliente.

`apps/api/src/routes/chatExterno.ts` no AtendAI existe, é autenticado por chave (`autenticarApiKey`), e o comentário dele **nomeia o ISPhub**:

> *"API pública do chat para sistemas externos (ISPhub e outros), autenticada por chave. Cada chamada age em nome de um colaborador do próprio sistema, referido pelo `idExterno`."*

Já entrega tudo que a demanda 2 precisa:

| rota | serve para |
|---|---|
| `POST /colaboradores` | registrar o técnico do ISPhub como colaborador (`idExterno` = id do usuário no ISPhub) |
| `POST /conversas` | abrir conversa `DIRETA`/`GRUPO` |
| `POST /conversas/:id/mensagens` | enviar |
| `GET /conversas/:id/mensagens` | ler |
| `POST /webhooks` | receber `chat_nova_mensagem`, assinado com segredo |

**A demanda 2 é escrever o cliente no ISPhub.** Não é construir protocolo.

### 2. A conversa com o cliente hoje só vai de ida.

`POST /avisos` manda mensagem avulsa para o telefone do cliente e **espelha na conversa** do AtendAI, reusando a máquina do gateway do SGP (janela de 24h → texto livre; fora dela → template aprovado).

Mas o disparador de webhook (`jobs/webhookSaida.ts`) só reage a `chat_nova_mensagem`, que é do **chat interno**. **Não existe evento de saída para mensagem de CLIENTE.** Do jeito que está, o técnico manda e nunca recebe a resposta.

**A demanda 1 exige uma adição no AtendAI**, não só código no ISPhub.

### 3. A chave é por tenant — e é exatamente isso que faz "quem diz é a OS" funcionar.

`req.sistemaExterno!.tenantId`: uma chave pertence a **um** provedor. O ISPhub atende vários. Então o mapeamento é **uma chave por `Provedor`**, e a cadeia fica:

```
OS  →  provedorId  →  chave do AtendAI  →  tenant  →  cliente certo
```

O nome do provedor na conversa **não vem do AtendAI**: o ISPhub já tem `Provedor.nome` e `Provedor.cor`. É dado que ele possui.

### 4. O ISPhub já tem chat com cliente próprio. Isto não o substitui em todo lugar.

`ConversaCliente`/`MensagemCliente` + canais WhatsApp por provedor já existem e funcionam. **Assunção deste plano** (se estiver errada, pare e pergunte): o AtendAI vira o transporte **para os provedores que têm chave cadastrada**, e quem não tem continua no caminho atual. Trocar para todo mundo derrubaria a conversa dos provedores que não usam AtendAI.

---

## Global Constraints

- **Isolamento por tenant é P0 no AtendAI.** Qualquer coisa que toque `prisma` lá corre sob `AsyncLocalStorage`; vazamento entre tenants tem suíte dedicada (`tests/isolamentoTenant.test.ts`).
- **A chave do AtendAI é segredo.** Guardar cifrada (`lib/crypto`, AES-256-GCM), do mesmo jeito que `ErpConfig` já guarda a credencial do SGP. **Nunca** devolver em GET nem logar.
- Webhook de entrada **valida assinatura** com o segredo devolvido no registro. Sem isso, qualquer um posta mensagem no chat da equipe.
- Commits em português, no estilo do repo. Verificação é `npm run typecheck` + `npm test` nos dois repos.

---

### Task 1: A chave do AtendAI por provedor (ISPhub)

Fundação das duas demandas. Sem ela não há como escolher o tenant.

**Files:** `apps/api/prisma/schema.prisma`, migração, `apps/api/src/services/atendaiService.ts` (+ teste), `apps/api/src/routes/provedores.ts`, tela de admin.

- [ ] **Step 1: Modelo**

`AtendaiConfig` (1-1 com `Provedor`), espelhando `ErpConfig`:

```prisma
model AtendaiConfig {
  id             String   @id @default(uuid())
  provedorId     String   @unique
  provedor       Provedor @relation(fields: [provedorId], references: [id], onDelete: Cascade)
  baseUrl        String
  /// Cifrada (AES-256-GCM). NUNCA volta em GET.
  chaveCifrada   String
  /// Segredo do webhook de entrada, devolvido pelo AtendAI no registro.
  segredoCifrado String?
  ativo          Boolean  @default(true)
  criadoEm       DateTime @default(now())
}
```

- [ ] **Step 2: Cliente HTTP, com o timeout que importa**

`atendaiService.ts`: `chamar(provedorId, metodo, caminho, corpo)` resolve a chave e chama. **Timeout curto (8s) e falha que não derruba a tela**: o AtendAI é outro sistema, e a fila do técnico não pode ficar refém do uptime dele.

- [ ] **Step 3: Teste da resolução, sem rede**

Pura: dado um provedor com config ativa → usa a chave dele; inativa ou ausente → `null` (e o chamador cai no caminho atual). É o teste que garante que provedor sem AtendAI **não** quebra.

- [ ] **Step 4: Tela de admin + commit**

Em `/admin/provedores/:id`, aba "AtendAI": baseUrl + chave (write-only, mascarada igual às do SGP) + botão "Testar conexão".

---

### Task 2: Chat interno federado (demanda 2)

**Files:** `apps/api/src/services/chatFederadoService.ts` (+ teste), `apps/api/src/routes/chat.ts`, `apps/api/src/routes/webhooks.ts`, schema.

- [ ] **Step 1: Marcar a conversa como federada**

`Conversa.atendaiConversaId String?` + `Conversa.provedorId String?`. Nulo = conversa só do ISPhub, como hoje.

- [ ] **Step 2: Provisionar o técnico como colaborador**

Na primeira mensagem federada, `POST /colaboradores` com `idExterno = usuario.id`. Idempotente do lado de lá; guardar o `colaboradorId` para não repetir.

- [ ] **Step 3: Espelhar a mensagem enviada**

Ao enviar numa conversa federada, replicar via `POST /conversas/:id/mensagens`. **Falha de rede não pode perder a mensagem do técnico**: gravar local primeiro, espelhar depois, e marcar pendente se falhar.

- [ ] **Step 4: Receber, validando a assinatura**

`POST /webhooks/atendai/chat` — valida o segredo, resolve o provedor pela conversa, grava a mensagem. **Sem assinatura válida, 401 e nada gravado.**

- [ ] **Step 5: Testes**

O que erra em silêncio: assinatura inválida não grava; evento repetido não duplica (idempotência por id da mensagem de lá); provedor sem AtendAI nunca chama a rede.

---

### Task 3: Conversa com o cliente da OS (demanda 1)

**Precisa do AtendAI antes.** Ordem obrigatória.

- [ ] **Step 1 (repo atendehub): evento de saída para mensagem de CLIENTE**

Hoje `jobs/webhookSaida.ts` só reage a `chat_nova_mensagem`. Acrescentar `cliente_nova_mensagem`, disparado quando entra mensagem do cliente numa `Conversa`. Mesma assinatura e mesmo backoff do que já existe — **não inventar um segundo mecanismo de webhook**.

- [ ] **Step 2 (ISPhub): abrir a conversa a partir da OS**

`POST /ordens-servico/:id/conversa-cliente`: pega `provedorId` e telefone da OS, resolve a chave daquele provedor, e usa `POST /avisos` para a primeira mensagem. O técnico só alcança OS **atribuída a ele** — a guarda já existe (`assertAcesso`).

- [ ] **Step 3: O nome do provedor na tela**

Cabeçalho da conversa com nome + cor do provedor, que o ISPhub já tem. É o requisito literal: *"na conversa deve aparecer o nome do provedor pra ele saber que o cliente é do provedor x"*.

- [ ] **Step 4: Receber a resposta do cliente**

`POST /webhooks/atendai/cliente` → grava em `MensagemCliente` da conversa correspondente.

- [ ] **Step 5: Fora da janela de 24h não é erro de código**

`/avisos` devolve **422** quando não há template aprovado. A tela tem de dizer *"o cliente não responde há mais de 24h; só dá para enviar modelo aprovado"* — e não "erro ao enviar". Confundir os dois faz o técnico repetir o envio.

---

## Notas de execução

**O que NÃO fazer:**

- **Não reimplementar a janela de 24h nem o envio por template.** `/avisos` já reusa a máquina do gateway do SGP de propósito, e o comentário lá diz por quê: seriam duas regras de janela para manter.
- **Não trocar o transporte de todos os provedores.** Quem não tem chave do AtendAI continua no caminho atual; trocar todo mundo derruba a conversa de quem não usa a plataforma.
- **Não guardar a chave em claro nem devolvê-la em GET.** O AtendAI já trata as chaves de LLM assim (`credenciaisIa.ts` mascara e nunca retorna o valor); seguir o mesmo padrão.
- **Não deixar a fila do técnico depender do uptime do AtendAI.** Timeout curto, falha silenciosa no caminho de leitura, pendência visível no de escrita.
- **Não criar um segundo mecanismo de webhook no AtendAI.** Acrescentar o evento ao que existe.

**Ordem:** Task 1 antes de tudo. Task 2 é independente da 3 depois dela. A Task 3 começa no repo do AtendAI.

**Deploy:** as duas pontas são deployadas separadamente (ISPhub no Coolify `.195`; AtendAI no `72.62.14.71`). A Task 3 exige subir o AtendAI **antes** do ISPhub, senão o webhook de cliente aponta para um evento que ninguém emite.
