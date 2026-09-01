# App do Técnico — Sessão Longa, Biometria que Dura e a Escolha de Salvar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o técnico abrir o app e entrar com a digital — hoje, amanhã e daqui a três semanas — sem digitar senha, com uma escolha única e explícita sobre o que fica salvo no aparelho.

**Architecture:** Nada disso é feature nova no servidor. O sistema de sessão longa está **inteiro e testado** na API (`SessaoRefresh`, rotação, janela de graça, `tokenVersion`, `sair-de-todos`), e `POST /auth/login` **já devolve `refreshToken` no corpo**. O app recebe esse campo e o descarta. O trabalho é o app passar a usar o que já chega, e a biometria passar a destrancar a sessão longa em vez do access token de 8h.

O painel web já adotou o refresh e resolveu o problema difícil (renovação única compartilhada, com o porquê escrito em `apps/web/src/lib/apiClient.ts:50-95`). Este plano **espelha aquele desenho** em vez de inventar outro.

**Tech Stack:** React Native / Expo SDK 57, expo-secure-store, expo-local-authentication, TanStack Query, TypeScript, vitest.

## O que existe hoje (verificado, não presumido)

| Peça | Estado |
|---|---|
| `POST /auth/login` | devolve `{ token, refreshToken, usuario }` — o app ignora `refreshToken` |
| `POST /auth/refresh` | pronta, pública, rotativa, `refreshLimiter`; devolve `{ token, refreshToken, usuario }` |
| `POST /auth/logout` | pronta, sem `requireAuth` de propósito; corpo `{ refreshToken }`; 204 |
| `SessaoRefresh` | 30 dias **parados**, deslizante; graça de rotação 30s; só o SHA-256 no banco |
| Reuso de refresh queimado | derruba TODAS as sessões do usuário (`revogarTudoDoUsuario`) |
| Biometria no app | `lib/biometria.ts`, fail-safe; auto-prompt no boot; `Switch` no Perfil |
| `JWT_EXPIRES_IN` | **8h** em produção (conferido na env do `isphub-api`) |
| E-mail lembrado | **não existe** — `useState("")` a cada abertura |
| Escolha "salvar dados" | **não existe** — o token é sempre gravado, em silêncio |

## O defeito que motiva o plano

A biometria destranca um **access token guardado**, e ele vive 8h. O dia do técnico:

- 7h30 — loga, liga a digital, funciona
- 15h30 — o token morre
- manhã seguinte — encosta o dedo e **cai na senha**

E `auth.tsx:126-133`, ao ver o token guardado inválido, apaga **também** `BIOMETRIA_KEY` e faz `setBiometriaAtiva(false)`. A biometria **se desliga sozinha**, sem avisar. Do lado de quem usa não lê como "token expirou", lê como *"funcionou uma vez, nunca mais"* — e ele para de confiar. É pior que não ter.

## Decisões de produto já tomadas (não reabrir)

- **Celular compartilhado é EXCEÇÃO.** A digital é o caminho principal e recebe o destaque; "só lembrar meu e-mail" existe para o caso compartilhado, mas não é o padrão.
- **30 dias parados está bom.** É o que `refreshService.ts` já faz. Não mexer na validade.
- **Senha nunca deixa de ser saída.** Nenhuma tela pode ficar sem o caminho de senha visível.

## Global Constraints

- Monorepo npm workspaces. Rodar comandos de dentro de `apps/mobile` salvo indicação contrária.
- Alias `@/*` → `./src/*`.
- **Lógica pura em arquivo sem import nativo.** Qualquer import que alcance `react-native` faz o vitest falhar no *parse* (fonte Flow), e nenhum `vi.mock` conserta — o grafo é resolvido antes. É por isso que `lib/modulos.ts` e `features/evidencias/limites.ts` existem separados.
- Verificação é `npm run typecheck` + `npm test`. `npx expo lint` está quebrado (`ts-api-utils` × TypeScript do repo) e **não** é regressão.
- Commits em português, assunto curto, corpo explicando o porquê.
- **Não mexer em `refreshService.ts` nem nas rotas de auth.** Elas estão prontas e cobertas; este plano é do lado do cliente. A única exceção é a Task 6, que só troca uma env var.

---

## Estrutura de arquivos

**Criar:**
- `apps/mobile/src/lib/sessao.ts` — dono do par (access, refresh) + renovação única compartilhada
- `apps/mobile/src/lib/sessao.test.ts` — teste da renovação única e do não-apagar-em-falha-de-rede
- `apps/mobile/src/lib/preferencia-acesso.ts` — o que cada escolha implica, **sem imports**
- `apps/mobile/src/lib/preferencia-acesso.test.ts`
- `apps/mobile/src/features/acesso/folha-escolha.tsx` — a folha pós-login

**Modificar:**
- `apps/mobile/src/lib/api.ts` — retry único no 401
- `apps/mobile/src/lib/auth.tsx` — guarda/usa o refresh; biometria não se desliga; expõe a preferência
- `apps/mobile/src/app/login.tsx` — e-mail lembrado, foco na senha, identidade na tela de bloqueio
- `apps/mobile/src/app/(app)/perfil.tsx` — o `Switch` de biometria vira a mesma escolha de três estados

---

### Task 1: O app guarda e usa o refresh que já recebe

Sem isto o resto é encenação: a biometria continuaria destrancando um token de 8h.

O ponto estrutural: hoje o token viaja como **parâmetro** (`apiFetch(path, { token })`, vindo do contexto React). Depois de uma renovação, todo caller ficaria com o token velho na mão. Por isso entra um dono de módulo — igual ao web — que o `AuthProvider` mantém em sincronia.

**Files:**
- Create: `apps/mobile/src/lib/sessao.ts`
- Test: `apps/mobile/src/lib/sessao.test.ts`
- Modify: `apps/mobile/src/lib/api.ts`
- Modify: `apps/mobile/src/lib/auth.tsx`

**Interfaces:**
- Produces (`sessao.ts`):
  - `getAccessToken(): string | null`
  - `setSessao(access: string | null, refresh: string | null): void`
  - `renovarSessao(): Promise<boolean>` — **única e compartilhada**
  - `assinarMudanca(fn: (access: string | null) => void): () => void`

- [ ] **Step 1: Escrever o teste antes**

Cria `apps/mobile/src/lib/sessao.test.ts`. Os dois comportamentos que importam e que ninguém percebe quando quebram:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// `sessao.ts` nao pode importar nada nativo — se importar, este mock nao salva:
// o vite falha no PARSE da fonte Flow da react-native, antes de qualquer mock.
const guardado = new Map<string, string>();
vi.mock("./token-store", () => ({
  tokenStore: {
    get: async (k: string) => guardado.get(k) ?? null,
    set: async (k: string, v: string) => void guardado.set(k, v),
    del: async (k: string) => void guardado.delete(k),
  },
}));

import { getAccessToken, renovarSessao, setSessao } from "./sessao";

describe("renovarSessao", () => {
  beforeEach(() => {
    guardado.clear();
    setSessao("velho", "refresh-1");
    vi.unstubAllGlobals();
  });

  it("N chamadas simultaneas fazem UMA rotacao so", async () => {
    // O refresh e ROTATIVO: a segunda chamada apresentaria um token que a
    // primeira acabou de queimar. O servidor tem 30s de graca pra isso, mas
    // gastar a graca por descuido do cliente e pedir problema — e fora da
    // janela o servidor derruba TODAS as sessoes do usuario por suspeita de
    // token clonado. Ou seja: o custo do erro e o tecnico deslogado no campo.
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => {
      chamadas++;
      return { ok: true, json: async () => ({ token: "novo", refreshToken: "refresh-2" }) };
    });

    const [a, b, c] = await Promise.all([renovarSessao(), renovarSessao(), renovarSessao()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(chamadas).toBe(1);
    expect(getAccessToken()).toBe("novo");
  });

  it("falha de REDE nao apaga a sessao", async () => {
    // Sem sinal no meio do mato nao e sessao invalida. Apagar aqui deslogaria
    // o tecnico exatamente quando ele nao tem como logar de novo.
    vi.stubGlobal("fetch", async () => {
      throw new Error("sem rede");
    });
    expect(await renovarSessao()).toBe(false);
    expect(getAccessToken()).toBe("velho");
  });

  it("401 do servidor apaga a sessao — ai sim ela morreu de verdade", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await renovarSessao()).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it("sem refresh guardado nao tenta nada", async () => {
    setSessao("velho", null);
    let chamou = false;
    vi.stubGlobal("fetch", async () => {
      chamou = true;
      return { ok: true, json: async () => ({}) };
    });
    expect(await renovarSessao()).toBe(false);
    expect(chamou).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/mobile && npm test
```

Esperado: FAIL — `./sessao` não existe.

- [ ] **Step 3: Implementar `sessao.ts`**

Espelhar `apps/web/src/lib/apiClient.ts:50-95`. Pontos obrigatórios, cada um com o motivo que o web já documentou:

1. **`renovacaoEmCurso: Promise<boolean> | null`** — uma renovação por vez. O app dispara várias queries no boot (fila, agenda, resumo, jornada, config); todas tomam 401 juntas quando o access vence.
2. **`fetch` cru, nunca `apiFetch`** — passar pelo `apiFetch` criaria recursão infinita (o 401 do refresh tentaria renovar de novo).
3. **Distinguir rede de 401.** `catch` de rede → `false` **sem apagar**. Resposta `!ok` → apaga a sessão. São situações opostas e colapsá-las desloga o técnico offline.
4. Persistir os dois em `tokenStore` (SecureStore) e notificar os assinantes.

Chaves: `isphub_token` (já existe, manter) e `isphub_refresh` (nova).

- [ ] **Step 4: Retry único no `apiFetch`**

Em `apps/mobile/src/lib/api.ts`, quando a resposta for **401** e houver token na chamada, tentar `renovarSessao()` uma vez e repetir a requisição com `getAccessToken()`.

```ts
// UMA tentativa, nunca um laco: se a renovacao nao resolveu, o 401 e real e
// tem que chegar na tela. Retry em laco viraria tempestade de refresh contra
// a rota que tem `refreshLimiter`.
```

Cuidados obrigatórios:
- **Não** tentar renovar quando o próprio path for `/auth/login`, `/auth/refresh` ou `/auth/logout`.
- O retry usa `getAccessToken()`, **não** o `opts.token` recebido — aquele é o token velho que o React ainda tem em mão.

- [ ] **Step 5: `auth.tsx` guarda o refresh e revoga no logout**

- `login()`: gravar `resp.refreshToken` via `setSessao(resp.token, resp.refreshToken)`.
- Restauração no boot: carregar os dois; se o access falhar no `/auth/me`, **tentar renovar antes de desistir**. É aqui que mora o ganho — hoje ele desiste direto.
- `logout()`: chamar `POST /auth/logout` com o refresh **antes** de limpar, para encerrar a sessão no servidor. Sem isso o refresh continua válido por 30 dias depois de "sair" — grave num aparelho compartilhado. Manter a ordem atual (desregistrar push primeiro, que precisa do access token).
- Assinar `assinarMudanca` para o `token` do contexto acompanhar as renovações.

- [ ] **Step 6: Typecheck e testes**

```bash
cd apps/mobile && npm run typecheck && npm test
```

- [ ] **Step 7: Verificar no aparelho (esta é a prova que importa)**

Instalar, logar e **esperar o access token vencer** (8h) — ou, para não esperar, subir a API local com `JWT_EXPIRES_IN=60s` e apontar o Metro pra ela (`adb reverse tcp:4100 tcp:4100`, ver `isphub-build-mobile`). Depois do vencimento, puxar a fila: deve carregar **sem** voltar pro login.

No log, a assinatura de sucesso é um `POST /auth/refresh` **único** — se aparecerem vários, a renovação compartilhada não está funcionando e a janela de graça está sendo gasta à toa.

- [ ] **Step 8: Commit**

```
Sessao longa no app: usar o refresh que ja vinha na resposta

/auth/login devolve refreshToken desde que a sessao longa entrou; o app
recebia e jogava fora, entao a sessao dele morria em 8h e a biometria junto.

A renovacao e UNICA e compartilhada, igual a do painel: o app dispara varias
queries no boot e todas tomam 401 juntas. Como o refresh e rotativo, a segunda
apresentaria um token que a primeira queimou — e fora da janela de graca o
servidor derruba TODAS as sessoes do usuario. O custo do descuido seria o
tecnico deslogado no campo.

Falha de rede nao apaga sessao; 401 apaga. Colapsar os dois deslogaria quem
esta sem sinal, que e justamente quem nao tem como logar de novo.

Logout agora revoga no servidor: sem isso o refresh valia 30 dias depois de
"sair", num aparelho que a equipe compartilha.
```

---

### Task 2: A biometria destranca a sessão longa, e nunca mais se desliga sozinha

Com a Task 1 no lugar, a biometria passa a valer por 30 dias de uso. Falta consertar o auto-desligamento — que é o que hoje ensina o técnico a não confiar nela.

**Files:**
- Modify: `apps/mobile/src/lib/auth.tsx`
- Test: `apps/mobile/src/lib/sessao.test.ts` (acrescentar)

- [ ] **Step 1: Separar a decisão do efeito**

Em `sessao.ts`, uma função **pura** para o que fazer quando o desbloqueio não conseguiu sessão:

```ts
export type DesfechoDesbloqueio = "entrou" | "pedir-senha" | "sem-rede";

/**
 * O que aconteceu quando a biometria passou mas a sessao nao veio.
 *
 * A distincao existe porque o comportamento errado ja custou confianca: hoje
 * QUALQUER falha apaga a preferencia de biometria, entao um tunel sem sinal
 * desliga a digital do tecnico permanentemente. Ele nao le isso como "sem
 * rede" — le como "essa porcaria nao funciona".
 *
 * `sem-rede` NAO e motivo pra mexer em nada: tenta de novo depois.
 */
export function desfechoDoDesbloqueio(renovou: boolean, houveRede: boolean): DesfechoDesbloqueio {
  if (renovou) return "entrou";
  return houveRede ? "pedir-senha" : "sem-rede";
}
```

- [ ] **Step 2: Testar a decisão**

Três casos, um por desfecho. O que trava a regressão:

```ts
it("sem rede NAO vira pedir-senha — foi assim que a digital se desligava sozinha", () => {
  expect(desfechoDoDesbloqueio(false, false)).toBe("sem-rede");
});
```

- [ ] **Step 3: `desbloquearComBiometria` passa a renovar**

Novo fluxo:

1. `autenticarBiometria(...)` — se o usuário cancelar, não mexer em nada.
2. Tentar o access token guardado no `/auth/me`.
3. **Se falhar, tentar `renovarSessao()`** — o passo que hoje não existe.
4. Conforme `desfechoDoDesbloqueio`:
   - `entrou` → entra
   - `pedir-senha` → limpar a sessão, **manter `BIOMETRIA_KEY`**, marcar `sessaoExpirou = true`
   - `sem-rede` → não apagar nada, devolver `false`, mensagem "Sem conexão. Tente de novo."

- [ ] **Step 4: A mensagem que re-arma**

Quando `sessaoExpirou`, a tela de login mostra:

> Sua sessão expirou. Entre com a senha — a digital volta a funcionar depois.

E como `BIOMETRIA_KEY` sobreviveu, o próximo login por senha **re-arma sozinho**, sem passar pelo Perfil. Hoje ele teria que ir caçar o switch.

- [ ] **Step 5: Typecheck, testes e verificação no aparelho**

No aparelho, o caso que importa: ligar a digital, **modo avião**, abrir o app. Esperado: mensagem de sem conexão e a digital **ainda ligada** no Perfil. Hoje ela estaria desligada.

- [ ] **Step 6: Commit**

```
A digital para de se desligar sozinha

Qualquer falha ao destrancar apagava a preferencia de biometria — inclusive
falta de sinal. O tecnico num tunel perdia a digital pra sempre e ia ter que
reativar no Perfil, coisa que ninguem descobre sozinho. O que ele conclui e
"funcionou uma vez, nunca mais", e ai nao liga de novo.

Agora o desbloqueio tenta renovar a sessao longa antes de desistir, e sem rede
nao e motivo pra mexer em nada. Sessao expirada de verdade limpa a sessao mas
PRESERVA a preferencia: o proximo login por senha re-arma sozinho.
```

---

### Task 3: Uma escolha só, depois do primeiro login

**Files:**
- Create: `apps/mobile/src/lib/preferencia-acesso.ts` (+ teste)
- Create: `apps/mobile/src/features/acesso/folha-escolha.tsx`
- Modify: `apps/mobile/src/lib/auth.tsx`, `apps/mobile/src/app/login.tsx`

**O desenho, e por quê:** "salvar os dados" são três coisas diferentes — lembrar o e-mail, manter a sessão, e entrar sem digitar. Três switches é pior que um. Vira **uma escolha com três saídas**, mostrada **depois** do primeiro login: antes, o técnico está tentando entrar e a pergunta é obstáculo; depois, o valor é concreto.

```
        Quer entrar mais rápido da próxima vez?

   ┌──────────────────────────────────────────┐
   │  👆  Usar impressão digital              │   ← padrão, destaque
   ├──────────────────────────────────────────┤
   │      Só lembrar meu e-mail               │
   ├──────────────────────────────────────────┤
   │      Não salvar nada neste aparelho      │
   └──────────────────────────────────────────┘
```

Sem "sessão", sem "credenciais", sem "token". A digital vem primeiro porque **compartilhado é exceção** (decisão do usuário).

- [ ] **Step 1: O mapa do que cada escolha implica (puro, sem imports)**

```ts
export type PreferenciaAcesso = "biometria" | "email" | "nada";

export interface EfeitoAcesso {
  guardaSessao: boolean;
  guardaEmail: boolean;
  pedeBiometria: boolean;
}

/**
 * "Nao salvar nada" tem que ser VERDADE, nao enfeite: sem refresh gravado, sem
 * e-mail gravado, sessao so em memoria — fechou o app, saiu. O proprio logout
 * ja registra que estes aparelhos sao compartilhados pela equipe, entao um
 * "nao salvar" que salva em silencio seria mentira com consequencia.
 */
export function efeitoDe(p: PreferenciaAcesso): EfeitoAcesso {
  if (p === "biometria") return { guardaSessao: true, guardaEmail: true, pedeBiometria: true };
  if (p === "email") return { guardaSessao: false, guardaEmail: true, pedeBiometria: false };
  return { guardaSessao: false, guardaEmail: false, pedeBiometria: false };
}
```

Teste: uma asserção por escolha, mais **`efeitoDe("nada").guardaSessao === false`** isolado, porque é o único cuja falha é um problema de segurança e não de conforto.

- [ ] **Step 2: A folha**

Reusar o padrão de folha que `features/jornada/viatura.tsx` já estabeleceu. Três `Pressable` grandes (alvo ≥ 44pt — mão suja, sol, luva), o primeiro com peso visual maior. Sem `Switch`: switch pede leitura, botão pede toque.

Se `checarBiometria()` disser indisponível, a primeira opção **não aparece** — e a folha vira duas opções, sem explicar hardware pra ninguém.

- [ ] **Step 3: Ligar no fluxo**

Mostrar **uma vez**, no primeiro login bem-sucedido do aparelho (marca em SecureStore). Nos seguintes, respeitar a escolha em silêncio. `guardaSessao: false` implica não gravar refresh nem access — a sessão vive só no estado do React.

- [ ] **Step 4: Perfil edita a mesma escolha**

O `Switch` de biometria em `perfil.tsx:210` vira o mesmo trio (um `Segmented` ou três linhas). **Um lugar só** define o comportamento; hoje o Perfil tem um switch e não existe controle nenhum para e-mail ou sessão.

- [ ] **Step 5: Typecheck, testes, verificação no aparelho**

- [ ] **Step 6: Commit**

```
Uma escolha so sobre o que fica salvo no aparelho

"Salvar os dados" sao tres coisas — lembrar e-mail, manter a sessao e entrar
sem digitar. Tres switches seria pior que um, entao virou uma escolha com tres
saidas, mostrada DEPOIS do primeiro login: antes o tecnico esta tentando
entrar, e a pergunta so atrapalha.

Digital em primeiro porque celular compartilhado e excecao aqui. "Nao salvar
nada" e literal: sem refresh, sem e-mail, sessao so em memoria.
```

---

### Task 4: A tela de login reconhece quem está voltando

**Files:** `apps/mobile/src/app/login.tsx`

- [ ] **Step 1: E-mail lembrado e foco na senha**

Quando há e-mail guardado, pré-preencher e **focar direto o campo de senha**. Um toque a menos e um teclado a menos — no sol, de luva, isso é a diferença entre entrar e xingar.

- [ ] **Step 2: Identidade na tela de bloqueio**

Quando `bloqueadoPorBiometria`, mostrar avatar + primeiro nome: **"Entrar como João"**, com **"Trocar de usuário"** discreto embaixo (limpa tudo e volta ao formulário).

Vale mesmo com compartilhado sendo exceção: na exceção, evita entrar como o colega sem perceber; na regra, é confirmação de que o app sabe quem ele é. O avatar já existe (`useAvatarUri`) e o nome já vem no `/auth/me` cacheado.

- [ ] **Step 3: Verificação no aparelho**

Três estados na mesma tela: primeiro acesso (formulário limpo), volta com digital (identidade + prompt automático), e sessão expirada (mensagem da Task 2 + senha, e-mail já preenchido).

- [ ] **Step 4: Commit**

---

### Task 5: Encurtar o access token (só depois que o app renovar sozinho)

`auth.ts:154` diz, com todas as letras, que o access token está preso em 8h **por causa do app**: encurtar quebraria o mobile, que não sabia renovar. Com as Tasks 1–4 no ar, essa amarra sai.

- [ ] **Step 1: Confirmar que os dois clientes renovam**

Painel e app, cada um com uma sessão que atravessa o vencimento sem cair no login. **Não seguir sem isso** — é o único passo do plano que degrada produção se estiver errado.

- [ ] **Step 2: Baixar para 15 min**

`JWT_EXPIRES_IN=15m` na env do `isphub-api` (Coolify novo, uuid `okbkpoowuwrtvge7rtxt7kf6`). Atenção à armadilha registrada em `isphub-project`: `PATCH .../envs` pode **duplicar** a chave em vez de atualizar — conferir com `GET .../envs` e apagar duplicata pelo uuid antes de recriar.

- [ ] **Step 3: Observar um dia inteiro antes de comemorar**

O sintoma de erro aqui não é erro na tela: é o técnico sendo deslogado no meio do expediente. Vale um dia de uso real com um técnico antes de considerar fechado.

- [ ] **Step 4: Commit da nota**

Sem arquivo de código; registrar a mudança de env no `isphub-project` (memória) e nas notas de deploy.

---

## Notas de execução

**O que NÃO fazer:**

- **Não mexer em `refreshService.ts` nem nas rotas de auth.** Estão prontas, testadas e em uso pelo painel. Este plano é do lado do cliente.
- **Não guardar a senha** em SecureStore para "replay" no login. É a saída fácil e troca uma credencial de sessão, revogável e rotativa, por uma credencial permanente do usuário. O refresh existe exatamente para não precisar disso.
- **Não colocar a escolha de salvar dados ANTES do login.** Vira obstáculo na hora errada, e a pessoa escolhe no escuro.
- **Não apagar sessão em falha de rede.** É a raiz do defeito que a Task 2 conserta; recriá-la em outro lugar traz o problema de volta com outra cara.
- **Não fazer retry em laço no 401.** `/auth/refresh` tem `refreshLimiter`; laço vira tempestade contra a rota mais sensível.
- **Não subir o Metro da raiz do monorepo** — ele "funciona" mas não lê o `.env` e o app cai em `http://localhost:4000` sem avisar.

**Ordem obrigatória:** Task 1 antes de tudo. As Tasks 2–4 são independentes entre si depois dela. A Task 5 é a última e só com as anteriores verificadas no aparelho.

**Cortes deliberados:**

- **`baixarAnexoAutenticado` não ganha retry.** Ele usa `FileSystem.downloadAsync`, fora do `apiFetch`. Na prática as queries de tela correm antes das imagens e já renovaram o token; o pior caso é uma miniatura em branco que aparece no próximo render. Se virar incômodo real, o conserto é passar o download pelo mesmo caminho — não replicar a lógica de renovação.
- **Sem tela de "sessões ativas".** `SessaoRefresh` já guarda `userAgent` e `ip` pensando nisso, mas ninguém pediu, e `sair-de-todos` já cobre o caso urgente (perdeu o celular).
- **Sem PIN próprio do app** como alternativa à biometria. O `expo-local-authentication` já cai no PIN/padrão do aparelho quando a biometria falha (`disableDeviceFallback: false`), então um PIN nosso seria um segundo segredo para o técnico esquecer.

**Estado do repositório ao começar:** limpo, `main` em `1d704e8`. As sessões anteriores deixaram o app do técnico no EAS Build com OTA ligado — mudanças deste plano são **só JS**, então vão por `eas update --branch production --environment production`, sem APK novo. Ver `isphub-ota`.
