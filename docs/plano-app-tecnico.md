# Plano — App do técnico ISPhub (`apps/mobile`, Fase 2)

**Objetivo:** app nativo (Expo/RN) onde cada técnico faz login, vê **só as OS atribuídas a ele**, executa em campo e fecha a OS (write-back pro SGP via API ISPhub). Dois diferenciais: **(1) modular por config do servidor** (admin liga/desliga módulos → aparecem/somem no app) e **(2) sempre atualizado** (mudança no Painel ou no SGP reflete no app rápido).

**Direção visual:** aprovada na Fase 0 — claro alto-contraste, SLA-first (cor só na urgência). Logo entra depois.

## Regras de arquitetura (invariantes)
- App é **cliente** da API. Não fala com o SGP direto, não reimplementa regra de negócio. Todo write-back passa pela API.
- **Escopo por técnico já é server-side:** `escopoOsWhere(user)` → `{ tecnicoId: user.sub }` para `role=tecnico` (`escopoService.ts:15-25`). O realtime também é **por técnico**.
- Auth **JWT HS256, 8h** (`authService.ts`), payload `{ sub, email, role, provedorId }`. Token em **expo-secure-store**. `GET /auth/me` re-busca e revalida `ativo` (desativar técnico derruba a sessão no próximo /me).
- Reutiliza **tipos de `packages/shared`** (`FilaItem`, `OsEvento`, `Notificacao`, `UserRole`, status + os novos `ModuloId`/`AppConfig`/`RealtimeEvento`). Serialização de `FilaFiltros` é manual (replicar o `buildQuery` do web).
- Fotos são **proxy ao vivo pro SGP** (sem model local de evidência). Fechar OS envia `os_data_finalizacao` (a API já faz — `writebackService.ts:82-83`).

---

## (a) Modelo de domínio — `ModuloId` (união fechada) + evento de realtime

**Decisão de modelagem (domain-modeling): `ModuloId` é uma união FECHADA.** O app tem *código* por módulo (uma feature-module por id); um id que o app não conhece não teria tela. Então o conjunto é fixo e vive no `shared` — o admin liga/desliga membros desse conjunto, **não inventa ids**.

```ts
// packages/shared/src/modulos.ts
export const MODULO_IDS = [
  "minhas-os",    // CORE — fila pessoal do técnico
  "evidencias",   // câmera → proxy SGP, fila offline
  "rota",         // mapa + GPS
  "conexao",      // ONU rx/tx, OLT, online/offline
  "assinatura",   // assinatura do cliente no fim da OS
  "retiradas",    // fila de retirada/cancelamento (equipe externa)
  "notificacoes", // in-app + (depois) push
] as const;
export type ModuloId = (typeof MODULO_IDS)[number];

export const MODULOS_CORE = ["minhas-os"] as const satisfies readonly ModuloId[];
export const isCore = (id: ModuloId) => (MODULOS_CORE as readonly string[]).includes(id);
```

**Estados ilegais irrepresentáveis — como garantimos `core nunca ativo=false`:** os metadados **imutáveis** de cada módulo (nome, ícone, se é core, roles padrão) vivem no **código** (`MODULO_CATALOGO`), não no banco — são propriedade do build. O banco guarda só o que o admin muda. Assim, `core` **nem é coluna** no banco → não há como representar `core=false`. O "habilitado" é **derivado**: `habilitado = isCore(id) || registro.ativo`. O core não depende do toggle.

```ts
// shared — catálogo imutável (fonte da verdade dos metadados)
export interface ModuloMeta { id: ModuloId; nome: string; icone: string; core: boolean; rolesPadrao: UserRole[]; }
export const MODULO_CATALOGO: Record<ModuloId, ModuloMeta> = {
  "minhas-os":   { id: "minhas-os",   nome: "Minhas OS",    icone: "list",  core: true,  rolesPadrao: [UserRole.TECNICO] },
  "evidencias":  { id: "evidencias",  nome: "Evidências",   icone: "camera",core: false, rolesPadrao: [UserRole.TECNICO] },
  // … rota, conexao, assinatura, retiradas, notificacoes
};
```

```prisma
// apps/api/prisma/schema.prisma — só o estado EDITÁVEL pelo admin
model ModuloConfig {
  id              String   @id @default(uuid())
  moduloId        String   @unique   // um dos MODULO_IDS (validado na aplicação)
  ativo           Boolean  @default(true)
  ordem           Int      @default(0)
  rolesPermitidos String[]           // subconjunto de UserRole; default herda rolesPadrao
  atualizadoEm    DateTime @updatedAt
  @@map("modulo_configs")
}
```
Migração **aditiva** (tabela nova). Seed/backfill: no primeiro boot, `ModuloConfig` ausente = usa o default do catálogo (core ativo, resto conforme decidirmos ligar de início).

**Config efetiva** (o que `/config` devolve) e **evento de realtime** — tipos compartilhados:
```ts
export interface ModuloHabilitado { id: ModuloId; nome: string; icone: string; core: boolean; ordem: number; }
export interface AppConfig { modulos: ModuloHabilitado[]; geradoEm: string; } // já ordenado, só habilitados

export type RealtimeEventoTipo = "os-alterada" | "os-atribuida" | "os-removida" | "config-alterada";
export interface RealtimeEvento { tipo: RealtimeEventoTipo; osId?: string; em: string; }
```
- `os-alterada` → invalida a lista + o detalhe daquela OS.
- `os-atribuida` → invalida lista + badge (nova OS pro técnico).
- `os-removida` → OS saiu do escopo do técnico (reatribuída/encerrada em outro canal) → remove da lista + avisa.
- `config-alterada` → refetch `/config` (admin mexeu nos módulos).

---

## (b) Contrato da API: `/config`, admin toggle, realtime e "sincronizar agora"

**`GET /config`** (`requireAuth`) — novo `configRouter`. Monta `AppConfig` pro `req.user`: cruza `MODULO_CATALOGO` × `ModuloConfig.ativo` × role (`rolesPermitidos.includes(role)` **ou** `isCore`). Devolve só habilitados, por `ordem`. Core sempre incluso. `ETag`/`geradoEm` pro cache condicional.

**Admin** (`requireRole(ADMIN)`) — mesmo padrão de guarda das outras rotas admin:
- `GET /admin/modulos` — catálogo completo + estado atual (pra tela de admin).
- `PATCH /admin/modulos/:moduloId` — body `{ ativo?, ordem?, rolesPermitidos? }`. **Guarda de core (validação no servidor):** se `isCore(moduloId) && body.ativo === false` → **422** "módulo core não pode ser desativado". Upsert em `ModuloConfig`. Emite `config-alterada`.

**Realtime — SSE escopado por técnico (a via recomendada; ver (d) pra justificativa):**
- `GET /eventos` (`requireAuth`, `Content-Type: text/event-stream`) — mantém a conexão; registra `req.user.sub` num **hub em memória** (`Map<userId, Set<res>>`); envia **keep-alive** (comentário SSE) a cada ~25s (proxies/Coolify cortam conexões ociosas); ao fechar, remove do hub.
- Emissão via um módulo pequeno `realtimeHub.emitParaUsuario(userId, evento)`, chamado de:
  - `writebackService` (a caminho / status / anotação / atribuir) → `os-alterada` pro técnico (+ `os-atribuida` no atribuir).
  - `syncService` → quando o pull do SGP muda uma OS de um técnico, `os-alterada`; se saiu do escopo, `os-removida`.
  - `slaAlertScheduler` → `os-alterada` (junto da `Notificacao` que já cria).
  - admin toggle → `config-alterada`.
- **Degradação:** SSE é best-effort — **se cair, ninguém percebe**, porque o React Query cobre (ver (d)). O servidor **não** guarda fila de eventos perdidos; ao reconectar/foreground o app dá refetch (a verdade está no `GET /fila`). SSE só reduz latência.
- **Por que hub em memória:** 1 processo Node no deploy atual + dezenas de técnicos → um `Map` basta. Escala horizontal futura = trocar o hub por Redis pub-sub sem mexer no app (o contrato do evento é o mesmo). **Registrado como risco.**

**Sincronizar agora (SGP→ISPhub sob demanda):** hoje `POST /provedores/:id/sync` é ADMIN/GESTOR e exige um provedor específico — o técnico não tem `provedorId`. Nova rota **`POST /sync/minhas-os`** (`requireAuth`): dispara `syncProvedor()` dos provedores que têm OS abertas **atribuídas ao técnico** (dedup), com **rate-limit por usuário (~1×/30s)** pra não martelar o SGP. Usada no botão "Sincronizar agora" e no pull-to-refresh. (Tuning opcional, não bloqueante: priorizar no `syncScheduler` provedores com OS ativas de técnicos → intervalo efetivo menor.)

**Endpoints reusados sem mudança:** `GET /fila?equipe=interna&grupo=abertos` (escopo já filtra por técnico), `GET /ordens-servico/:id`, `/:id/eventos`, `POST /:id/acaminho`, `PATCH /:id/status`, `POST /:id/anotacoes`, `POST|GET /:id/evidencias` + `/arquivo`, `GET /notificacoes/contagem|/|:id/lida`, `GET /conexao/...` (ONU), `GET /auth/me`, `POST /auth/login`.

---

## (c) Navegação dinâmica + módulo desligado em runtime/offline

- **expo-router monta a navegação a partir de `/config`.** Um mapa central `id → { tela, tab }` (o "registro" de módulos). Só os módulos **habilitados** viram tab/rota — módulo desligado **nem é registrado** (não é só escondido): deep-link pra ele cai num "não disponível", não numa tela morta.
- **Guarda dupla:** servidor (`/config` só devolve habilitados; toda rota de dado continua protegida por role no backend) **e** cliente (`<RequireModulo id="rota">` + o router só cria as telas presentes na config).
- **Core sempre presente:** `minhas-os` tem fallback hard-coded — se `/config` falhar/vier vazia, o app ainda abre a fila. Nunca fica sem o core.
- **Desligado enquanto aberto** (`config-alterada` chega e o técnico está na tela de um módulo que saiu): navega de volta pra Minhas OS + toast "Este recurso foi desativado". Sem crash.
- **Offline:** cacheia a última `/config` (MMKV). No cold start sem rede, monta a navegação pela config cacheada. Ao voltar a rede, refetch + reconciliação com **animação** de entrada/saída de tabs.

---

## (d) Freshness: ISPhub→app, SGP→ISPhub, conflito, offline

**ISPhub→app — React Query (backbone) + SSE (nudge) + push (trigger):**
- **Backbone = @tanstack/react-query:** `refetchOnReconnect` + `refetchOnAppForeground` (via `AppState`) + `refetchInterval` curto **só enquanto foreground+ativo** (poupa bateria/dados) + `invalidate` por evento. Cada refetch é **independente** — nada pra "babá". Depois de qualquer buraco (túnel, doze do Android, zona morta), a frescura **volta sozinha** em segundos.
- **SSE (server→client) escopado por técnico** entra como *redução de latência* quando a rede está boa: `onmessage` → `queryClient.invalidateQueries` pela `osId` do evento. **Só uma via** (servidor→app) → **SSE, não WebSocket** (menos infra, reconexão nativa). Se cair, o backbone cobre.
- **WebSocket é overkill:** bidirecional que não precisamos, mais dependência, mesmo problema de conexão presa caindo em campo — sem ganho sobre SSE aqui.
- **Push (expo-notifications)** = gatilho assíncrono (app em background): nova OS / mudança relevante → acorda o app, dispara refetch + badge. (Depende de infra de servidor que **ainda não existe** — ver risco 4.)

**SGP→ISPhub (limite honesto):** o app **nunca fica mais fresco que o ISPhub**, que é espelho do SGP via sync (`syncScheduler`, tick 1 min honrando `intervaloPollingSegundos` por provedor). Mitigação: (a) tuning do intervalo pras OS ativas; (b) `POST /sync/minhas-os` + pull-to-refresh.

**Reconciliação/conflito (write offline):**
- Mutations com **fila offline** (React Query `onlineManager` + persistência). O write-back server-side já é **idempotente**: chama o SGP primeiro e reconcilia (ex.: reencerrar OS já encerrada é tratado como sucesso idempotente no connector).
- Ao drenar uma mutation enfileirada: se a OS **já não está "aberta/atribuída a ele"** (reatribuída/encerrada em outro canal), o `assertAcesso` responde 403/404 (saiu do escopo) ou o status já é final → o app **remove da lista ativa + toast "Esta OS foi atualizada/encerrada em outro canal"**. **Nunca sobrescreve cegamente.**
- **Feedback visual:** item que muda/sai **anima** a transição (Reanimated layout), não "pisca". Mutation pendente mostra "enviando…/pendente de sinal".

**Offline geral:** última `/config` + última `/fila` cacheadas (query cache persistido). App abre mostrando a fila conhecida, marcada "atualizada há X", e sincroniza ao ter rede.

---

## (e) Estrutura `apps/mobile` (feature-modules) + libs

```
apps/mobile/
  app/                     # expo-router (rotas)
    _layout.tsx            # providers: QueryClient, Auth, Config, Realtime
    login.tsx
    (app)/                 # grupo autenticado
      _layout.tsx          # monta as tabs DINAMICAMENTE a partir da config
      minhas-os/index.tsx  # lista (CORE)
      minhas-os/[id].tsx   # detalhe
      evidencias/…         # rota da feature (só registrada se habilitada)
  src/
    features/{minhas-os,evidencias,rota,conexao,assinatura,retiradas,notificacoes}/
                           # cada uma: tela + hooks + componentes, autocontida
    lib/
      api/                 # cliente fetch + header auth; buildQuery(FilaFiltros)
      auth/                # secure-store, contexto, /auth/me
      config/             # /config, cache offline, registro id→tela, RequireModulo
      realtime/            # cliente SSE + invalidation
      query/               # QueryClient, chaves, persistência
      ui/                  # design system (tokens claro alto-contraste, SLA, componentes)
  app.config.ts  eas.json  # expo (dev client, permissões) + perfis de build
```
Cada feature-module é **autocontida** (nada que outro módulo precise importar). O acoplamento fica num **registro central** pequeno (`id → componente`).

**Libs (com justificativa):**
| Lib | Por quê |
|---|---|
| `expo` + `expo-router` | navegação file-based, deep-linking — padrão Expo |
| `@tanstack/react-query` | **backbone de freshness** (coração da estratégia (d)) |
| `expo-secure-store` | JWT no keychain/keystore (regra de arquitetura) |
| `react-native-mmkv` | cache offline de `/config` + query cache persistido (rápido/síncrono) |
| `react-native-reanimated` v4 + `react-native-gesture-handler` | reorder/swipe/transições |
| `expo-camera` + `expo-image-manipulator` | foto + compressão client-side (JPEG ≤1600px → base64 pro `POST /evidencias`, cap 2MB) |
| `expo-location` (+ mapa) | módulo rota (endereço/lat-lng já vêm no `FilaItem` do backfill) |
| `expo-notifications` | push (quando o servidor existir) |
| `nativewind` | Tailwind no RN — mantém a linguagem do web (decidir com expo-tailwind-setup) |
| `react-native-sse` | RN não tem `EventSource` nativo |
| `@isphub/shared` | reutiliza tipos — não duplica shapes |

---

## (f) Telas por módulo × endpoints

- **minhas-os (CORE)** — Lista: `GET /fila?equipe=interna&grupo=abertos` (escopo=técnico), ordena SLA-first; pull-to-refresh → `POST /sync/minhas-os`. Detalhe: `GET /ordens-servico/:id` + `/:id/eventos` (histórico) + `GET /conexao/...` (ONU). Ações: `POST /:id/acaminho`, `PATCH /:id/status` (iniciar/concluir → `os_data_finalizacao` automático no server), `POST /:id/anotacoes`.
- **evidencias** — `POST /:id/evidencias` (base64), `GET /:id/evidencias` (grid), `GET /:id/evidencias/:anexoId/arquivo` (proxy). Fila offline de upload.
- **rota** — `expo-location` + mapa; "abrir no mapa"/navegação até o cliente.
- **conexao** — `GET /conexao/...`: ONU rx/tx, OLT, online/offline ao vivo (mesmo endpoint do web).
- **assinatura** — captura (canvas) → anexa como evidência (reusa `POST /evidencias`).
- **retiradas** — `GET /fila?equipe=externa` (só com o módulo habilitado).
- **notificacoes** — `GET /notificacoes/contagem` (badge; polling leve + SSE), `GET /notificacoes` (lista), `POST /:id/lida`.

---

## (g) Admin web `/admin/modulos` (`apps/web`, shadcn)

Nova `apps/web/src/pages/admin/ModulosPage.tsx` na `AdminNav`. Lista o `MODULO_CATALOGO`: switch `ativo` (**core travado com cadeado** + tooltip), reordenar (setas ↑/↓ no MVP — o repo não tem dnd-kit), escopo por role (multi-select de `UserRole`). Chama `GET /admin/modulos` + `PATCH /admin/modulos/:id`; toast de confirmação; espelha o mockup #6 e o design da web (frontend-design + web-design-guidelines).

---

## (h) Animações + riscos

**Animações** (Reanimated v4 + Gesture Handler; respeita reduced-motion; durações curtas; **sem bounce** — é ferramenta de trabalho):
- Transições de tela (fade/slide curto); lista com entrada/saída + **reorder** quando o realtime muda a fila (`LinearTransition`) — item que sai anima out, não pisca; swipe-actions no card; skeleton loaders; "check" discreto ao fechar OS; entrada/saída suave de tabs quando o admin toggla módulo.

**Riscos:**
1. **Permissões nativas** (câmera/GPS/push): exigem **dev client** (não Expo Go) + config no `app.config.ts`. Se o técnico negar, a feature avisa e degrada.
2. **Upload de foto em campo**: rede ruim → fila offline + retry idempotente; cap 2MB + compressão; `express.json 5mb` no server cobre.
3. **SSE atrás do Coolify**: proxies cortam conexão ociosa → keep-alive ping + reconexão nativa; e o polling cobre se cair. Custo de conexões abertas é baixo hoje, mas **escala horizontal exige trocar o hub em memória por Redis pub-sub**.
4. **Push não existe hoje** (grep zero). Mínimo de servidor (só listado, não implementar no MVP): tabela `DeviceToken { usuarioId, token, plataforma }` + `POST /devices` (registro) + gatilho no `atribuirTecnico`/`slaAlert` chamando a Expo Push API. **Fase própria**; MVP entrega notificação in-app por polling+SSE.
5. **EAS build/distribuição**: dev client + build interno exigem conta EAS e **podem ter custo** — não rodar build pago sem sua autorização (eas-workflows pra pipeline).
6. **Sync sob demanda**: rate-limit por usuário (30s) + dedup por provedor pra não martelar o SGP.
7. **iOS**: técnicos são majoritariamente Android → focar Android no build interno; iOS/push exige conta Apple (custo).

---

## Verificação (TDD nos fluxos críticos)
Unit: motor de módulos (config efetiva — core sempre, role cruzada, ordem) + **guarda de core** (PATCH `ativo=false` em core → 422); reconciliação de conflito (OS fora de escopo → remove); `buildQuery(FilaFiltros)`. A cada parte: `typecheck` + `build` + testes (vitest na API, jest/RNTL no mobile) + **code-review** + **verification-before-completion** (nada de "pronto" sem evidência).

## Ordem de implementação (incremental, após aprovação)
1. **Motor de módulos** — shared (`ModuloId` união fechada + catálogo + `AppConfig`) + Prisma `ModuloConfig` + migração + `GET /config` + admin toggle + **testes (guarda de core)**.
2. **`apps/mobile` scaffolding** — expo-router, QueryClient, auth secure-store (`/auth/login` + `/me`), `/config`, **navegação dinâmica + fallback core**.
3. **minhas-os** — lista SLA-first + detalhe + ações write-back, contra a API real.
4. **Realtime** — hub SSE no server + cliente + invalidation + freshness (foreground/reconnect/interval) + `POST /sync/minhas-os`.
5. Demais módulos (evidencias, conexao, rota…) incrementais.
6. `/admin/modulos` (web).
7. Animações. → depois: push (fase própria).
