# ISPhub — Chat interno de operação (API + Web + Mobile)

> Prompt de implementação, autocontido. Cole no Claude Code para executar a
> feature ponta a ponta. Escrito depois de uma exploração real da base — os
> caminhos e padrões citados existem e devem ser reaproveitados.

## Papel e objetivo

Você é engenheiro full-stack sênior. Implemente um CHAT INTERNO no ISPhub
(central de campo multi-provedor que espelha OS do SGP) para técnicos,
gestores/supervisores e admins conversarem. NÃO é um messenger social: é uma
ferramenta de coordenação de campo — conversa ancorada no trabalho, auditável.

Hoje essa coordenação acontece fora do sistema (WhatsApp pessoal): sem
rastreabilidade, contexto perdido, e o gestor sem saber o que foi combinado
numa OS. O chat existe para trazer isso para dentro.

Monorepo: `/Users/clebson/Documents/github/isphub` (npm workspaces)

- `apps/api` — Node/TS + Express + Prisma + PostgreSQL
- `apps/web` — React 19 + Vite + Tailwind v4 + shadcn/ui (Radix) + Framer Motion + GSAP
- `apps/mobile` — React Native/Expo + React Query + react-native-sse
- `packages/shared` (`@isphub/shared`) — tipos/enums compartilhados

## Referência visual

Messenger limpo estilo WhatsApp/Telegram: lista de conversas com avatar,
preview, timestamp e **badge amarelo** de não-lidas; linha de "stories" no
topo; presença "Online" no cabeçalho da conversa; menu de mensagem com
reagir/copiar/responder/encaminhar/apagar; bottom sheet "New Chat / New
Contact / New Community"; bolhas próprias em amarelo à direita.

**Não copie — eleve.** As traduções específicas estão na seção A.6.

## LEIA ANTES DE ESCREVER CÓDIGO (a base já resolve metade disso)

Não reinvente o que existe. Leia e reutilize:

- `apps/api/src/services/realtimeHub.ts` — hub SSE **em memória já pronto**
  (`registrarConexao` / `emitParaUsuario` / `emitParaTodos`). É onde o chat publica.
- `apps/api/src/routes/eventos.ts` — endpoint SSE `GET /eventos` (keep-alive 25s).
- `packages/shared/src/modulos.ts` — `MODULO_IDS` (união FECHADA), `MODULO_CATALOGO`,
  `RealtimeEventoTipo`, `RealtimeEvento`.
- `packages/shared/src/roles.ts` — `UserRole { ADMIN, GESTOR, TECNICO, PROVEDOR }`,
  `ROLES_INTERNOS = [ADMIN, GESTOR]`, `USER_ROLE_LABEL`.
- `apps/api/src/middleware/auth.ts` — `requireAuth` (popula `req.user = JwtPayload
  { sub, email, role, provedorId }`) e `requireRole(...roles)`.
- `apps/api/src/services/escopoService.ts` — filosofia de visibilidade por role.
- `apps/api/src/services/writebackService.ts` (`atribuirTecnico`, ~linha 182-198) —
  **o padrão a copiar para escrita**: `prisma.$transaction([...])` que grava o
  registro + cria `OsEvento` + cria `Notificacao`, e DEPOIS `emitParaUsuario(...)`.
- `apps/api/src/routes/notificacoes.ts` — padrão de rota (contagem leve + lista sob
  demanda + marcar lida). `apps/api/src/routes/tecnicos.ts` — rota simples.
- `apps/api/src/app.ts` — `createApp()`: helmet, cors, `express.json({limit:"5mb"})`,
  routers montados **na raiz** (não há prefixo `/api/v1`), `errorHandler` no fim.
- `apps/web/src/lib/apiClient.ts` (`api.get/post/getBlob`, Bearer de
  `localStorage["isphub_token"]`, `ApiError` com `.status`) e
  `apps/web/src/lib/notificacoesApi.ts` (convenção de módulo de API).
- `apps/web/src/components/NotificationBell.tsx` — padrão de badge + popover +
  atualização otimista (hoje polling 45s).
- `apps/web/src/components/AppShell.tsx` — `NAV_ITEMS`, helper `iniciais(nome)`
  (LOCAL, não exportado), nav única que vira bottom-tab abaixo de `lg`.
- `apps/web/src/lib/imagem.ts` — compressão de imagem no browser (canvas, ≤1600px,
  JPEG 0.75) já usada em evidências. **Reuse** para foto do chat.
- `apps/web/src/lib/clipboard.ts` — `numeroWhatsApp()`. **Reuse** no botão de ligar.
- `apps/web/src/components/ui/*` — button (variant `"brand"`), card, dialog,
  popover, tabs, input, label, switch, table.
- `apps/mobile/src/lib/realtime.tsx` — cliente SSE do mobile (react-native-sse);
  `apps/mobile/src/features/*` — estrutura de feature-module do app.

## PRINCÍPIOS INEGOCIÁVEIS

1. **Auditável, não efêmero.** Apagar mensagem é SOFT DELETE. Nada some do banco.
2. **Ancorado no trabalho.** A conversa mais importante é a da OS, não a social.
3. **Segurança por participação.** TODA leitura/escrita valida no servidor que o
   usuário é participante da conversa. Nunca confie no cliente.
4. **PROVEDOR fica de fora.** O chat é da equipe interna (ADMIN, GESTOR, TECNICO).
   Usuários `role=provedor` não têm acesso a nada do chat.
5. **SSE é best-effort.** Igual à doutrina já escrita em `realtimeHub.ts`: o SSE só
   REDUZ latência; se cair, um polling de fallback cobre. Nada de fila de eventos
   perdidos.
6. **O técnico está no celular, com uma mão, no sol.** Alvos ≥44px, áudio,
   respostas rápidas, offline tolerante.

---

# FASE 0 — Fundação compartilhada (`packages/shared` + módulo)

## 0.1 Registrar o chat como MÓDULO (idioma da casa)

Em `packages/shared/src/modulos.ts`:

- Adicione `"chat"` a `MODULO_IDS` (união fechada — o app tem código por id).
- `MODULO_CATALOGO.chat = { id:"chat", nome:"Chat", icone:"message-circle",
  core:false, ativoPadrao:true, ordemPadrao:45,
  rolesPadrao:[UserRole.GESTOR, UserRole.TECNICO] }`.

Assim o admin liga/desliga o chat por role em `/admin/modulos` sem deploy.

## 0.2 Ampliar o contrato de realtime

Ainda em `modulos.ts`, amplie `RealtimeEventoTipo` com:

```
"chat-mensagem" | "chat-leitura" | "chat-digitando" | "chat-conversa"
```

E amplie `RealtimeEvento` com campos opcionais do chat:
`conversaId?: string; mensagemId?: string; autorId?: string`.

Mantenha `em: string` (ISO) e `osId?` como estão. **Não quebre os consumidores
atuais** (o mobile já lê esse tipo).

## 0.3 Tipos do chat (`packages/shared/src/types.ts` ou `chat.ts` novo)

Exporte enums e interfaces (nomes em pt-BR, como o resto do projeto):

- `enum ConversaTipo { DIRETA="direta", GRUPO="grupo", OS="os", AVISOS="avisos" }`
- `enum MensagemTipo { TEXTO="texto", FOTO="foto", AUDIO="audio",
  LOCALIZACAO="localizacao", OS_REF="os_ref", SISTEMA="sistema" }`
- `ConversaResumo { id, tipo, titulo, avatarCor?, ordemServicoId?, sgpOsId?,
  participantes: ParticipanteResumo[], ultimaMensagem?: MensagemResumo,
  naoLidas: number, silenciado: boolean, atualizadoEm }`
- `ParticipanteResumo { usuarioId, nome, role, online: boolean, ultimaAtividadeEm? }`
- `Mensagem { id, conversaId, autor?: ParticipanteResumo, tipo, corpo?, anexoMime?,
  anexoTamanho?, duracaoSeg?, lat?, lng?, ordemServicoId?,
  respondendoA?: { id, autorNome, resumo }, reacoes: { emoji, usuarioIds }[],
  editadoEm?, apagadoEm?, criadoEm }`
- Amplie o union de `Notificacao.tipo` (hoje `"atribuicao"|"sla_estourado"`) com
  `"mensagem"` e `"mencao"`. A coluna no banco já é `String` — é só TS.

---

# FASE A — API + Web

## A.1 Schema Prisma (`apps/api/prisma/schema.prisma`)

Justifique cada índice em comentário, como o resto do schema já faz.

```prisma
enum ConversaTipo { direta grupo os avisos }
enum MensagemTipo { texto foto audio localizacao os_ref sistema }

model Conversa {
  id             String        @id @default(uuid())
  tipo           ConversaTipo
  titulo         String?       // grupo/avisos; direta e os derivam o título
  /// Thread de OS: 1 conversa por OS, no máximo.
  ordemServicoId String?       @unique
  ordemServico   OrdemServico? @relation(fields:[ordemServicoId], references:[id], onDelete: Cascade)
  criadoPorId    String?
  criadoPor      Usuario?      @relation("ConversasCriadas", fields:[criadoPorId], references:[id], onDelete: SetNull)
  /// Denormalizado: ordena a lista sem varrer mensagens (N+1).
  ultimaMensagemEm DateTime?
  arquivada      Boolean       @default(false)
  criadoEm       DateTime      @default(now())
  participantes  ConversaParticipante[]
  mensagens      Mensagem[]
  @@index([tipo, ultimaMensagemEm])
}

model ConversaParticipante {
  id          String   @id @default(uuid())
  conversaId  String
  conversa    Conversa @relation(fields:[conversaId], references:[id], onDelete: Cascade)
  usuarioId   String
  usuario     Usuario  @relation(fields:[usuarioId], references:[id], onDelete: Cascade)
  admin       Boolean  @default(false)   // pode renomear/adicionar/remover (grupo)
  /// Marca d'água de leitura: não-lidas = mensagens com criadoEm > este valor.
  /// Evita uma linha de "lido" por mensagem (que explodiria em volume).
  ultimaLeituraEm DateTime?
  silenciado  Boolean  @default(false)
  saiuEm      DateTime?
  @@unique([conversaId, usuarioId])
  @@index([usuarioId, conversaId])
}

model Mensagem {
  id            String       @id @default(uuid())
  conversaId    String
  conversa      Conversa     @relation(fields:[conversaId], references:[id], onDelete: Cascade)
  /// null = mensagem do sistema ("Fulano assumiu a OS").
  autorId       String?
  autor         Usuario?     @relation(fields:[autorId], references:[id], onDelete: SetNull)
  tipo          MensagemTipo
  corpo         String?      // texto, legenda da foto, ou rótulo do sistema
  // Mídia: bytea local (chat NÃO é evidência de OS, então não vai pro SGP).
  anexoDados    Bytes?
  anexoMime     String?
  anexoTamanho  Int?
  duracaoSeg    Int?         // áudio
  lat           Float?
  lng           Float?
  /// Card de OS compartilhado no chat.
  ordemServicoId String?
  ordemServico  OrdemServico? @relation("MensagensOsRef", fields:[ordemServicoId], references:[id], onDelete: SetNull)
  respondendoAId String?
  respondendoA  Mensagem?    @relation("Respostas", fields:[respondendoAId], references:[id], onDelete: SetNull)
  respostas     Mensagem[]   @relation("Respostas")
  editadoEm     DateTime?
  /// SOFT DELETE — contexto operacional é prova; nada some do banco.
  apagadoEm     DateTime?
  apagadoPorId  String?
  criadoEm      DateTime     @default(now())
  reacoes       MensagemReacao[]
  @@index([conversaId, criadoEm])
}

model MensagemReacao {
  id         String   @id @default(uuid())
  mensagemId String
  mensagem   Mensagem @relation(fields:[mensagemId], references:[id], onDelete: Cascade)
  usuarioId  String
  usuario    Usuario  @relation(fields:[usuarioId], references:[id], onDelete: Cascade)
  emoji      String
  criadoEm   DateTime @default(now())
  @@unique([mensagemId, usuarioId, emoji])
}
```

E em `Usuario`, adicione:

```prisma
  /// Presença barata: atualizado (com throttle) a cada request autenticado.
  ultimaAtividadeEm DateTime?
```

Migração aditiva (`npm run prisma:migrate -w @isphub/api`), sem backfill
destrutivo. Adicione as relações inversas em `Usuario`/`OrdemServico`.

**Limites de mídia (valide no servidor, não só no cliente):** foto ≤ 400KB depois
da compressão; áudio ≤ 60s e ≤ 500KB; mimes permitidos `image/jpeg|png|webp` e
`audio/webm|audio/mp4|audio/m4a|audio/ogg`. Comente no código o caminho de
migração para S3/MinIO se o volume crescer.

## A.2 Serviços (`apps/api/src/services/chatService.ts`)

Lógica de negócio isolada do router. Funções puras onde der (testáveis):

- `podeParticipar(user, conversa)` — guarda por participação. PROVEDOR sempre
  `false`. Espelhe o espírito de `escopoService.podeAcessarOs`.
- `garantirConversaDeOs(osId, autorId)` — cria a thread da OS sob demanda
  (idempotente, graças ao `@unique`) e popula participantes: técnico atribuído +
  todos admin/gestor ativos.
- `enviarMensagem(...)` — **copie o padrão de `writebackService.atribuirTecnico`**:
  um `prisma.$transaction` que (a) cria a `Mensagem`, (b) atualiza
  `Conversa.ultimaMensagemEm`, (c) cria `Notificacao` para os participantes
  não-silenciados que estão offline ou fora da conversa, (d) se for thread de OS e
  a mensagem for um MARCO (resposta rápida que muda status), cria também o
  `OsEvento`. Só DEPOIS da transação, faça o fan-out SSE com `emitParaUsuario`
  para cada participante.
  > ⚠️ **Não** gere um `OsEvento` por mensagem comum — inundaria a timeline da OS.
- `marcarLida(conversaId, usuarioId)` — atualiza `ultimaLeituraEm` e emite
  `"chat-leitura"` pros outros participantes.
- `contarNaoLidas(usuarioId)` — total agregado, endpoint leve pro badge.
- Menções: extraia `@nome` do corpo, resolva para usuários participantes, crie
  `Notificacao` tipo `"mencao"`.

## A.3 Rotas (`apps/api/src/routes/chat.ts`, montado `app.use("/chat", chatRouter)`)

`chatRouter.use(requireAuth)` + guarda que **bloqueia `role=provedor`** em todas.
Valide entrada com zod. Handlers em `asyncHandler`, erros com `HttpError`.

- `GET /chat/conversas` — lista `ConversaResumo` (ordenada por `ultimaMensagemEm`),
  com `naoLidas` e última mensagem. Uma query só; nada de N+1.
- `GET /chat/conversas/:id/mensagens?antesDe=&limit=30` — paginação por cursor
  (`criadoEm`), mais recentes primeiro. Mensagem apagada volta sem corpo/anexo.
- `POST /chat/conversas` — cria DIRETA (idempotente: se já existe entre os dois,
  devolve a existente) ou GRUPO (só ADMIN/GESTOR cria grupo).
- `POST /chat/conversas/de-os/:osId` — garante e devolve a thread da OS.
- `POST /chat/conversas/:id/mensagens` — envia. Body discriminado por `tipo`.
  Foto/áudio chegam em base64 dentro do JSON (o `express.json({limit:"5mb"})` já
  cobre — mesmo precedente das evidências, sem multer).
- `POST /chat/conversas/:id/lida`
- `POST /chat/mensagens/:id/reacoes` (toggle) · `DELETE /chat/mensagens/:id`
  (soft delete; só o autor, ou admin) · `PATCH /chat/mensagens/:id` (editar texto,
  marca `editadoEm`)
- `POST /chat/conversas/:id/digitando` — efêmero, só emite SSE, não grava nada.
- `GET /chat/mensagens/:id/anexo` — devolve os bytes com `Content-Type` certo (o
  cliente busca autenticado e vira `blob:` URL, como já faz em evidências).
- `GET /chat/contatos` — **não reutilize o `/usuarios` admin-gated**. Endpoint
  próprio devolvendo projeção MÍNIMA (`id, nome, role, online`) apenas de
  ADMIN/GESTOR/TECNICO ativos. Nunca vaze email/provedorId/hash aqui.
- `GET /chat/nao-lidas` — `{ total: number }`, leve, pro badge.
- Avisos: canal único `tipo=AVISOS`; escrita restrita a ADMIN/GESTOR
  (`requireRole`), leitura para todos os internos.

**Rate limit:** aplique `express-rate-limit` no POST de mensagens (siga o padrão de
`loginLimiter` em `routes/auth.ts`). Ex.: 30 msg/min por usuário.

## A.4 Presença (middleware leve)

Middleware após `requireAuth` que atualiza `Usuario.ultimaAtividadeEm` no máximo
1x/60s por usuário (guarde o último write num `Map` em memória para não bater no
banco a cada request). `online = ultimaAtividadeEm > agora - 2min`.

## A.5 Web — primeiro cliente SSE do projeto

> ⚠️ **ARMADILHA REAL:** `EventSource` do browser **não envia header
> `Authorization`**, e o `GET /eventos` exige Bearer. **Não** coloque o token na
> query string (vaza em log de proxy/histórico).

Implemente `apps/web/src/lib/realtime.ts` com `fetch()` +
`ReadableStream`/`TextDecoder` lendo o stream `text/event-stream` com o header
Bearer normal, embrulhado em: reconexão com backoff exponencial (1s→30s), parada
em `AbortController` no unmount, e **fallback para polling** se o stream falhar
repetidamente. Exponha um `RealtimeProvider` + hook `useRealtime(onEvento)`.

## A.6 Web — UI (aqui mora a referência visual)

Nova rota `/chat` em `App.tsx` com `<RequireAuth roles={[ADMIN, GESTOR, TECNICO]}>`,
novo item em `NAV_ITEMS` (`AppShell.tsx`) com ícone `MessageCircle` e
`ocultoPara:[UserRole.PROVEDOR]`, e a página envolve o próprio `<AppShell>` (o
shell não é global).

**Layout desktop:** duas/três colunas — lista de conversas (esq., ~340px) · thread
(centro, flex) · painel de contexto opcional (dir., só em thread de OS: mini card
da OS com SLA/cliente/endereço e ações). Abaixo de `lg`: uma coluna só, lista →
thread empurra a view (voltar no cabeçalho).

**Traduza a referência assim (não copie: eleve):**

- **Linha de "stories" do topo → "Em campo agora"**: avatares circulares dos
  técnicos com ANEL de status (verde=online, âmbar=em OS agora, cinza=offline).
  Clicar abre a DM. Um padrão social virando leitura de operação — é a assinatura
  desta tela.
- **Lista de conversas**: avatar com iniciais (extraia `iniciais()` do
  `AppShell.tsx` para `lib/utils.ts` e crie `components/Avatar.tsx` — hoje está
  duplicável), nome, preview de 1 linha (com prefixo "Você:" quando for sua),
  timestamp em `font-mono`, e **badge âmbar de não-lidas** (o amarelo da referência
  → use o token `--warning`/accent, não um amarelo solto). Thread de OS mostra
  `OS #sgpOsId` + pastilha do semáforo de SLA.
- **Bolhas**: as suas alinhadas à direita com fundo âmbar/accent; as dos outros à
  esquerda em `bg-secondary`. Cantos arredondados generosos, agrupamento por autor
  (avatar só na primeira do bloco), separador de data ("Hoje"). Timestamp discreto
  em `font-mono`. **Renderize texto como TEXTO PURO** — jamais
  `dangerouslySetInnerHTML`.
- **Menu de mensagem** (hover no desktop / long-press no mobile), como na
  referência: **Reagir** (fila rápida de emojis), **Responder** (a resposta aparece
  citada acima da bolha), **Encaminhar**, **Copiar**, **Apagar** (soft delete → a
  bolha vira "Mensagem apagada" em itálico e mantém o autor/hora). Use Radix
  Popover/DropdownMenu, navegável por teclado.
- **Composer**: textarea que cresce até ~5 linhas, Enter envia / Shift+Enter quebra
  linha, botão de anexo (foto/localização/OS) e **botão de microfone com gravação
  por pressão** (MediaRecorder, waveform simples, cancelar arrastando). Botão de
  envio `variant="brand"`.
- **Cabeçalho da thread**: nome + presença ("Online" / "visto há 12min"), e o ícone
  de chamada da referência vira **`tel:` + WhatsApp** (reuse `numeroWhatsApp` de
  `lib/clipboard.ts`) — **nada de WebRTC**.
- **Bottom sheet "New Chat/Contact/Community" → "Nova conversa"**: dialog com busca
  de contatos (`GET /chat/contatos`) em abas **Pessoas · Grupo · OS** (a aba OS
  busca uma OS e abre/cria a thread dela).
- **Anexo card de OS**: bolha especial com faixa do semáforo de SLA, categoria,
  cliente, endereço e botão "Abrir OS" (abre o `OrdemServicoDetailDialog` que já
  existe).
- **Respostas rápidas** (só em thread de OS, visíveis pro técnico): chips
  "A caminho" · "Cheguei" · "Cliente ausente" · "Preciso de apoio". As três
  primeiras **executam a mudança de status real da OS** via `writebackService` e
  postam mensagem do sistema; "Preciso de apoio" cria `Notificacao` para todos os
  gestores/admins. Isso é o coração do "chat como ferramenta de operação".
- **Estados**: skeleton na primeira carga, empty state ilustrado ("Nenhuma conversa
  ainda"), erro com "Tentar de novo". Autoscroll pro fim ao abrir e ao chegar
  mensagem **só se o usuário já estava no fim** (senão mostre a pílula "↓ novas
  mensagens").
- **Badge global**: contador de não-lidas no item "Chat" do `NAV_ITEMS` (hoje nenhum
  item tem badge — crie o suporte) e no header, alimentado por SSE com fallback de
  polling.

**Design system:** use os tokens e componentes existentes (Card, Dialog, Popover,
Tabs, Button `variant="brand"`, `font-mono` para horários, Bricolage Grotesque nos
títulos). Respeite `prefers-reduced-motion` em toda animação (padrão já seguido no
projeto). Contraste AA em bolhas e badges nos DOIS temas.

---

# FASE B — Mobile (app do técnico)

Só comece depois da Fase A validada. Reaproveite 100% dos tipos de
`@isphub/shared` e os mesmos endpoints.

- Nova feature-module em `apps/mobile/src/features/chat/`, seguindo a estrutura das
  features existentes, exibida conforme o módulo `"chat"` estiver habilitado para a
  role (motor de módulos).
- Consuma o SSE pelo cliente que já existe (`apps/mobile/src/lib/realtime.tsx`,
  react-native-sse) tratando os novos eventos `chat-*` e invalidando as queries do
  React Query correspondentes.
- Telas: lista de conversas · thread · nova conversa. Prioridade absoluta para
  **áudio** (expo-av), **foto** (câmera, reusando o pipeline de compressão) e
  **localização** (expo-location) — é o que o técnico usa de mão única.
- Fila offline: mensagem enviada sem rede fica "pendente" e sobe quando voltar
  (mesmo espírito da fila offline de evidências já existente).

---

# GUARDRAILS

- Não quebre `npm run build`, `npm run typecheck`, lint (oxlint) nem os testes e2e
  (Playwright, `apps/web/e2e`). **Rode a e2e ANTES** para ter baseline.
- Não altere rótulos/aria de que os testes dependem sem atualizar os testes.
- Sem dependência nova no backend (o SSE já existe; nada de socket.io/Redis). No
  front, só o que for realmente necessário para áudio.
- Nunca `dangerouslySetInnerHTML` em conteúdo de mensagem.
- Nunca exponha email/hash/provedorId em `/chat/contatos`.
- Toda rota valida participação no servidor. Escreva um teste que prove que um
  usuário NÃO participante recebe 403 ao ler mensagens de uma conversa alheia.
- Comente decisões não óbvias em pt-BR, no mesmo estilo denso do código atual.

# VERIFICAÇÃO (defina "pronto")

1. **Unit (`apps/api`)**: `podeParticipar` (matriz de roles, incluindo provedor
   bloqueado), cálculo de não-lidas pela marca d'água, idempotência de
   `garantirConversaDeOs` e de DM duplicada, validação de limite de mídia.
   `npm test -w @isphub/api`.
2. **Migração**: aplicar local e conferir as tabelas novas + a coluna
   `ultimaAtividadeEm` em `usuarios`.
3. **Fluxo manual (2 navegadores, 2 usuários)**: gestor abre DM com técnico →
   mensagem aparece no outro browser **sem refresh** (prova o SSE) → badge
   incrementa → abrir a conversa zera o badge → responder/reagir/encaminhar →
   apagar vira "Mensagem apagada" → derrubar a API e confirmar que o fallback de
   polling assume e a reconexão volta sozinha.
4. **Thread de OS**: abrir uma OS → iniciar conversa → técnico toca "A caminho" →
   confirmar que o **status da OS mudou de verdade** e que apareceu UM `OsEvento`
   (não um por mensagem).
5. **Segurança**: com o token de um usuário C, tentar
   `GET /chat/conversas/:id/mensagens` de uma conversa entre A e B → 403. Com um
   token `role=provedor`, qualquer rota `/chat` → 403.
6. `npm run typecheck` + `npm run build` + e2e verdes; cole a saída como prova.
7. Commits pequenos e temáticos: shared/módulo · schema+migração · serviço · rotas ·
   realtime web · UI web · mobile. Nada de commit único gigante.

Antes de cada fase, mostre um plano curto do que vai mudar e prossiga.
**Comece pela FASE 0.**
