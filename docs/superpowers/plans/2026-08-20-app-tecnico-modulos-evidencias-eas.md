# App do Técnico — Módulos, Evidências e Build de Produção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o gate de módulo que falta no app do técnico, entregar o módulo `evidencias` (foto de OS com fila offline) e passar a gerar o APK de produção no EAS Build com keystore própria.

**Architecture:** Três frentes independentes sobre `apps/mobile`, na ordem: primeiro infraestrutura de teste (não existe hoje), depois código (gating + evidências), por último empacotamento. O módulo `evidencias` reusa o que o chat já resolveu — câmera, compressão, download autenticado e fila offline em AsyncStorage — e a API já está pronta, fazendo proxy das fotos para o SGP sem cópia local dos bytes.

**Tech Stack:** React Native / Expo SDK 54, expo-router, TanStack Query, AsyncStorage, NetInfo, expo-image-picker, expo-image-manipulator, TypeScript, vitest.

## Global Constraints

- Monorepo npm workspaces: `packages/*` e `apps/*`. Rodar comandos de dentro de `apps/mobile` salvo indicação contrária.
- Alias de import no mobile: `@/*` → `./src/*` (ver `apps/mobile/tsconfig.json`).
- Tipos compartilhados vêm de `@isphub/shared`; após mexer em `packages/shared`, rodar `npm run build:shared` na raiz antes do typecheck.
- `ModuloId` é união **fechada** — módulo novo exige entrada em `MODULO_IDS` **e** em `MODULO_CATALOGO`.
- O `/config` filtra módulo por papel (`apps/api/src/services/moduloService.ts:50`). Módulo que o técnico precisa ver tem de ter `UserRole.TECNICO` em `rolesPadrao`.
- Limite de evidência na API: **2 MB decodificados** (`EVIDENCIA_TAMANHO_MAX_BYTES`, `apps/api/src/routes/ordensServico.ts:174`).
- `mimeType` é obrigatório no POST de evidência: `"image/jpeg" | "image/png" | "image/webp"`.
- `npx expo lint` está quebrado no mobile (incompatibilidade `ts-api-utils`) — **não** é regressão e não deve bloquear nada. Verificação usa `npm run typecheck` e `npm test`.
- Commits em português, no estilo do repo (assunto curto, corpo explicando o porquê).

---

## Estrutura de arquivos

**Criar:**
- `apps/mobile/vitest.config.ts` — runner, alias `@/`, ambiente node
- `apps/mobile/src/lib/modulos.test.ts` — teste do predicado de gating
- `apps/mobile/src/features/evidencias/limites.ts` — tipos e guarda de tamanho, **zero imports**
- `apps/mobile/src/features/evidencias/limites.test.ts` — teste da guarda de tamanho
- `apps/mobile/src/features/evidencias/api.ts` — cliente das 3 rotas
- `apps/mobile/src/features/evidencias/outbox.ts` — fila offline por OS
- `apps/mobile/src/features/evidencias/outbox.test.ts` — teste da fila
- `apps/mobile/src/features/evidencias/galeria.tsx` — grade de fotos + botões de captura

**Modificar:**
- `apps/mobile/package.json` — devDependency `vitest`, script `test`
- `apps/mobile/src/lib/config.tsx` — `moduloHabilitado` + `useModuloHabilitado`
- `packages/shared/src/modulos.ts` — promover `linha-movel` a `ModuloId`
- `apps/mobile/src/app/(app)/perfil.tsx:168` — gatear `CartaoMinhaLinha`
- `apps/mobile/src/app/(app)/minhas-os/index.tsx` — comentar por que `FolhaViatura` **não** é gateado
- `apps/mobile/src/app/(app)/minhas-os/[id].tsx` — usar o helper novo; montar a seção de evidências
- `apps/mobile/app.json` — desduplicar; remover `updates.requestHeaders`
- `apps/mobile/eas.json` — perfis com `env` e `autoIncrement` (arquivo existe, não versionado)

---

### Task 1: Infraestrutura de teste + predicado de gating

Hoje `apps/mobile` não tem teste nenhum. Esta tarefa cria o runner e entrega o primeiro pedaço testável: o predicado que decide se um módulo está ligado.

O predicado é **separado do hook** de propósito. Hook exige renderizador; predicado puro não. É o que mantém o setup pequeno.

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/vitest.config.ts`
- Modify: `apps/mobile/src/lib/config.tsx`
- Test: `apps/mobile/src/lib/modulos.test.ts`

**Interfaces:**
- Consumes: `ModuloHabilitado`, `ModuloId`, `MODULOS_CORE` de `@isphub/shared`
- Produces:
  - `moduloHabilitado(modulos: ModuloHabilitado[], id: ModuloId): boolean`
  - `useModuloHabilitado(id: ModuloId): boolean`

- [ ] **Step 1: Instalar o vitest**

```bash
cd apps/mobile && npm install -D vitest@^3.2.4
```

- [ ] **Step 2: Criar a config do vitest**

Cria `apps/mobile/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Escopo deliberado: SO logica pura. Nao ha preset de React Native aqui —
 * componente nao e testado automaticamente, e verificacao de tela continua
 * sendo no aparelho. Foi a troca escolhida pra nao arrastar jest-expo +
 * testing-library so pra cobrir outbox e gating, que sao funcoes puras.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Adicionar o script de teste**

Em `apps/mobile/package.json`, dentro de `"scripts"`, acrescentar:

```json
    "test": "vitest run"
```

- [ ] **Step 4: Escrever o teste que falha**

Cria `apps/mobile/src/lib/modulos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModuloHabilitado } from "@isphub/shared";
import { moduloHabilitado } from "./config";

const lista: ModuloHabilitado[] = [
  { id: "minhas-os", nome: "Minhas OS", icone: "list", core: true, ordem: 10 },
  { id: "chat", nome: "Chat", icone: "message-circle", core: false, ordem: 45 },
];

describe("moduloHabilitado", () => {
  it("devolve true para modulo presente na lista", () => {
    expect(moduloHabilitado(lista, "chat")).toBe(true);
  });

  it("devolve false para modulo ausente", () => {
    expect(moduloHabilitado(lista, "evidencias")).toBe(false);
  });

  it("devolve true para o core mesmo se a lista vier vazia", () => {
    // A garantia de primeiroNaoVazio (config.tsx) e "nunca ficar sem a fila".
    // O predicado tem de honrar isso sozinho, senao um /config vazio derrubaria
    // a tela principal.
    expect(moduloHabilitado([], "minhas-os")).toBe(true);
  });

  it("nao promove modulo nao-core quando a lista vem vazia", () => {
    expect(moduloHabilitado([], "chat")).toBe(false);
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que falha**

```bash
cd apps/mobile && npm test
```

Esperado: FAIL — `moduloHabilitado` não é exportado por `./config`.

- [ ] **Step 6: Implementar o predicado e o hook**

Em `apps/mobile/src/lib/config.tsx`, acrescentar `MODULOS_CORE` ao import existente de `@isphub/shared` (já está lá) e `type ModuloId`:

```ts
import { MODULOS_CORE, MODULO_CATALOGO, type AppConfig, type ModuloHabilitado, type ModuloId } from "@isphub/shared";
```

E, ao final do arquivo:

```ts
/**
 * "Esse modulo esta ligado pra este usuario?" — predicado PURO, separado do
 * hook porque e o que da pra testar sem renderizador.
 *
 * O core responde `true` mesmo com lista vazia: `primeiroNaoVazio` garante que
 * o app nunca fica sem a fila, e o predicado nao pode furar essa garantia.
 */
export function moduloHabilitado(modulos: ModuloHabilitado[], id: ModuloId): boolean {
  if ((MODULOS_CORE as readonly string[]).includes(id)) return true;
  return modulos.some((m) => m.id === id);
}

/**
 * Versao hook, pra uso em tela. Existe porque sem ela cada tela repete
 * `modulos.some(...)` na mao — foi assim que `linha-movel` acabou renderizando
 * sem gate nenhum.
 */
export function useModuloHabilitado(id: ModuloId): boolean {
  const { modulos } = useModulos();
  return moduloHabilitado(modulos, id);
}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
cd apps/mobile && npm test
```

Esperado: PASS, 4 testes.

- [ ] **Step 8: Typecheck**

```bash
cd apps/mobile && npm run typecheck
```

Esperado: sem erros.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/package.json apps/mobile/vitest.config.ts apps/mobile/src/lib/config.tsx apps/mobile/src/lib/modulos.test.ts package-lock.json
git commit -m "Teste no app do tecnico, e o predicado de modulo que faltava

O apps/mobile nao tinha runner nenhum. Entra vitest, o mesmo da API, com
escopo deliberado de logica pura — componente segue verificado no aparelho.

O predicado sai separado do hook porque hook exige renderizador e predicado
nao. Ele tambem honra o core sozinho: /config vazio nao pode derrubar a fila."
```

---

### Task 2: `linha-movel` vira módulo, e o `frota` fica documentado

`CartaoMinhaLinha` renderiza em `perfil.tsx:168` sem nenhum gate, e `linha-movel` nem é `ModuloId` — não há interruptor para ele em lugar nenhum.

`frota` é caso **oposto** e não deve ser mexido: a ausência dele em `ROTAS_MODULO` é deliberada (o técnico declara viatura dentro da jornada, que é core) e `frota.rolesPadrao` não inclui `TECNICO`, então gatear esconderia a viatura de todo técnico. Esta tarefa deixa isso escrito no código.

**Files:**
- Modify: `packages/shared/src/modulos.ts`
- Modify: `apps/mobile/src/app/(app)/perfil.tsx`
- Modify: `apps/mobile/src/app/(app)/minhas-os/index.tsx`
- Modify: `apps/mobile/src/app/(app)/minhas-os/[id].tsx`

**Interfaces:**
- Consumes: `useModuloHabilitado` (Task 1)
- Produces: `"linha-movel"` como membro de `MODULO_IDS` e chave de `MODULO_CATALOGO`

- [ ] **Step 1: Acrescentar `linha-movel` à união fechada**

Em `packages/shared/src/modulos.ts`, dentro de `MODULO_IDS`, logo após a linha de `"chat-clientes"`:

```ts
  "linha-movel", // chip CITmax do proprio tecnico (consulta de consumo e plano)
```

- [ ] **Step 2: Acrescentar a entrada no catálogo**

Em `MODULO_CATALOGO`, antes da entrada `frota`:

```ts
  /*
   * O chip da CITmax do proprio tecnico — consumo, plano e status da linha,
   * exibido como cartao dentro do Perfil (nao vira aba, por isso nao entra em
   * ROTAS_MODULO no app).
   *
   * TECNICO nas roles NAO e opcional: e o unico papel que de fato usa a tela, e
   * o /config filtra por papel (moduloService.ts:50). Sem ele o cartao sumiria
   * do app inteiro — que foi exatamente o erro quase cometido com `frota`.
   *
   * `ativoPadrao: true` pelo criterio da casa (precisa de configuracao externa
   * pra servir?): o vinculo da linha vem do cadastro do usuario, nao de chave
   * de integracao, e a tela degrada sozinha ("sem linha vinculada").
   */
  "linha-movel": { id: "linha-movel", nome: "Minha linha", icone: "smartphone", core: false, ativoPadrao: true, ordemPadrao: 75, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
```

- [ ] **Step 3: Rebuildar o shared e rodar o typecheck do monorepo**

```bash
cd /Users/clebson/Documents/github/isphub && npm run build:shared && npm run typecheck
```

Esperado: sem erros. Se algum ponto de `apps/api` ou `apps/web` exigir tratamento exaustivo de `ModuloId`, o compilador aponta — corrigir seguindo o padrão do vizinho antes de seguir.

- [ ] **Step 4: Gatear o cartão no perfil**

Em `apps/mobile/src/app/(app)/perfil.tsx`, trocar o import da linha 8:

```ts
import { useModuloHabilitado } from "@/lib/config";
```

Dentro do componente, junto dos outros hooks:

```ts
  const temLinhaMovel = useModuloHabilitado("linha-movel");
```

E na linha 168, trocar `<CartaoMinhaLinha />` por:

```tsx
        {temLinhaMovel && <CartaoMinhaLinha />}
```

- [ ] **Step 5: Documentar por que `FolhaViatura` NÃO é gateado**

Em `apps/mobile/src/app/(app)/minhas-os/index.tsx`, imediatamente acima do `<FolhaViatura` (por volta da linha 195):

```tsx
          {/*
            Sem gate de modulo, de proposito. Declarar viatura e gesto da
            JORNADA, que e core — nao do modulo `frota`, cujo toggle governa as
            telas de frota no painel web.

            E gatear em `frota` esconderia isto de todo tecnico: as rolesPadrao
            do modulo sao [ADMIN, GESTOR] e o /config filtra por papel
            (apps/api/src/services/moduloService.ts:50), entao o tecnico nunca
            recebe `frota` na lista.
          */}
```

- [ ] **Step 6: DRY nos dois gates inline do detalhe da OS**

Em `apps/mobile/src/app/(app)/minhas-os/[id].tsx`, trocar o import da linha 8:

```ts
import { useModuloHabilitado } from "@/lib/config";
```

E substituir as linhas 59–61:

```ts
  const { modulos } = useModulos();
  const temProvisionamento = modulos.some((m) => m.id === "provisionamento");
  const temChat = modulos.some((m) => m.id === "chat");
```

por:

```ts
  const temProvisionamento = useModuloHabilitado("provisionamento");
  const temChat = useModuloHabilitado("chat");
```

- [ ] **Step 7: Typecheck e testes**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Esperado: sem erros; 4 testes passando.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/modulos.ts apps/mobile/src/app apps/mobile/src/lib
git commit -m "Minha linha vira modulo; e o frota fica explicado

O cartao da linha movel renderizava no perfil sem gate, e nem existia como
ModuloId — nao havia interruptor pra ele em lugar nenhum. Agora existe, com
TECNICO nas roles, senao o /config filtraria e o cartao sumiria.

O frota fica como esta, com um comentario dizendo por que: declarar viatura
e gesto da jornada, que e core, e as roles do modulo nao incluem tecnico."
```

---

### Task 3: Evidências — cliente da API e fila offline

A API já está pronta (`apps/api/src/routes/ordensServico.ts:195-222`) e faz proxy das fotos para o SGP. Esta tarefa entrega a camada de dados do app: as três chamadas, a guarda de tamanho e a fila que segura foto tirada sem rede.

A fila espelha `features/chat/outbox.ts`, com duas diferenças: agrupa por `osId` e guarda o base64 **já comprimido** — comprimir ao enfileirar, não ao enviar, pra fila não reter o arquivo original inteiro.

**Files:**
- Create: `apps/mobile/src/features/evidencias/limites.ts`
- Test: `apps/mobile/src/features/evidencias/limites.test.ts`
- Create: `apps/mobile/src/features/evidencias/api.ts`
- Create: `apps/mobile/src/features/evidencias/outbox.ts`
- Test: `apps/mobile/src/features/evidencias/outbox.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `baixarAnexoAutenticado` de `@/lib/api`; `EvidenciaResumo` de `@isphub/shared`
- Produces (`limites.ts`, puro):
  - `EVIDENCIA_TAMANHO_MAX_BYTES: number`
  - `tamanhoBase64EmBytes(base64: string): number`
  - `cabeNoLimite(base64: string): boolean`
- Produces (`api.ts`):
  - `listarEvidencias(osId: string, token: string | null): Promise<EvidenciaResumo[]>`
  - `enviarEvidencia(osId: string, token: string | null, corpo: EvidenciaInput): Promise<EvidenciaResumo[]>`
  - `EvidenciaInput = { dados: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; legenda?: string }`
- Produces (`outbox.ts`):
  - `EvidenciaPendente = { localId: string; osId: string; input: EvidenciaInput; criadoEm: string; falhou: boolean }`
  - `enfileirarEvidencia(osId: string, input: EvidenciaInput): Promise<EvidenciaPendente>`
  - `listarPendentesDaOs(osId: string): Promise<EvidenciaPendente[]>`
  - `useProcessarFilaEvidencias(): void`

> **Por que `limites.ts` existe separado do `api.ts`:** `@/lib/api` importa
> `expo-file-system/legacy`, que é módulo nativo e não carrega em ambiente node.
> Se a guarda de tamanho morasse no `api.ts`, testá-la exigiria mockar o nativo —
> mock que existiria só para contornar um acoplamento desnecessário. Lógica pura
> em arquivo sem imports testa sem cerimônia nenhuma.

- [ ] **Step 1: Escrever o teste da guarda de tamanho**

Cria `apps/mobile/src/features/evidencias/limites.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EVIDENCIA_TAMANHO_MAX_BYTES, cabeNoLimite, tamanhoBase64EmBytes } from "./limites";

describe("tamanhoBase64EmBytes", () => {
  it("conta bytes decodificados, nao caracteres", () => {
    // "AAAA" -> 3 bytes. O tamanho em caracteres (4) enganaria por 33%.
    expect(tamanhoBase64EmBytes("AAAA")).toBe(3);
  });

  it("desconta o padding", () => {
    expect(tamanhoBase64EmBytes("AAA=")).toBe(2);
    expect(tamanhoBase64EmBytes("AA==")).toBe(1);
  });

  it("trata string vazia", () => {
    expect(tamanhoBase64EmBytes("")).toBe(0);
  });
});

describe("cabeNoLimite", () => {
  it("aceita foto abaixo do limite", () => {
    expect(cabeNoLimite("A".repeat(1000))).toBe(true);
  });

  it("recusa acima do limite da API", () => {
    // 4 caracteres base64 = 3 bytes; pra estourar 2MB precisamos de mais que
    // MAX*4/3 caracteres.
    const caracteres = Math.ceil((EVIDENCIA_TAMANHO_MAX_BYTES * 4) / 3) + 8;
    expect(cabeNoLimite("A".repeat(caracteres))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/mobile && npm test
```

Esperado: FAIL — módulo `./limites` não existe.

- [ ] **Step 3: Implementar os limites (arquivo puro, sem imports)**

Cria `apps/mobile/src/features/evidencias/limites.ts`:

```ts
/**
 * Espelha EVIDENCIA_TAMANHO_MAX_BYTES da API
 * (apps/api/src/routes/ordensServico.ts:174). Duplicado de proposito: o valor
 * nao esta em @isphub/shared, e o app precisa recusar ANTES de enfileirar —
 * descobrir o estouro so na hora do envio esconderia a falha do tecnico.
 */
export const EVIDENCIA_TAMANHO_MAX_BYTES = 2 * 1024 * 1024;

export type EvidenciaMime = "image/jpeg" | "image/png" | "image/webp";

export interface EvidenciaInput {
  /** Base64 puro, sem o prefixo "data:...;base64,". */
  dados: string;
  /** Obrigatorio na API (z.enum) mesmo ela nao repassando ao SGP — omitir da 400. */
  mimeType: EvidenciaMime;
  legenda?: string;
}

/** Bytes decodificados, sem decodificar: cada 4 caracteres viram 3 bytes, menos o padding. */
export function tamanhoBase64EmBytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function cabeNoLimite(base64: string): boolean {
  return tamanhoBase64EmBytes(base64) <= EVIDENCIA_TAMANHO_MAX_BYTES;
}

```

- [ ] **Step 4: Implementar o cliente da API**

Cria `apps/mobile/src/features/evidencias/api.ts`:

```ts
import type { EvidenciaResumo } from "@isphub/shared";
import { apiFetch, baixarAnexoAutenticado } from "@/lib/api";
import type { EvidenciaInput } from "./limites";

export async function listarEvidencias(osId: string, token: string | null): Promise<EvidenciaResumo[]> {
  return apiFetch<EvidenciaResumo[]>(`/ordens-servico/${osId}/evidencias`, { token });
}

export async function enviarEvidencia(osId: string, token: string | null, corpo: EvidenciaInput): Promise<EvidenciaResumo[]> {
  return apiFetch<EvidenciaResumo[]>(`/ordens-servico/${osId}/evidencias`, {
    method: "POST",
    token,
    body: corpo,
  });
}

/**
 * A listagem devolve EvidenciaResumo sem URL de miniatura, entao nao da pra
 * alimentar <Image source={{uri}}> direto dela — cada foto exige baixar o
 * arquivo com o JWT, mesmo padrao do useAvatarUri.
 */
export function caminhoArquivoEvidencia(osId: string, anexoId: string): string {
  return `/ordens-servico/${osId}/evidencias/${anexoId}/arquivo`;
}

export async function baixarEvidencia(osId: string, anexoId: string, token: string | null): Promise<string> {
  return baixarAnexoAutenticado(caminhoArquivoEvidencia(osId, anexoId), token);
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd apps/mobile && npm test
```

Esperado: PASS, 9 testes no total.

- [ ] **Step 6: Escrever o teste da fila offline**

Cria `apps/mobile/src/features/evidencias/outbox.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fakes em memoria. O modulo real do AsyncStorage puxa codigo nativo, que nao
// existe fora do aparelho — por isso o mock, e nao um ambiente RN completo.
const memoria = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memoria.get(k) ?? null,
    setItem: async (k: string, v: string) => void memoria.set(k, v),
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
// `@/lib/auth` puxa biometria e push (nativos) e `@/lib/api` puxa
// expo-file-system — nenhum dos dois carrega em node. O outbox importa os dois
// no topo, entao o mock e obrigatorio pro modulo sequer avaliar.
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), baixarAnexoAutenticado: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ token: null }) }));

import { enfileirarEvidencia, listarPendentesDaOs, marcarFalhouParaTeste, removerPendenteParaTeste } from "./outbox";

const input = { dados: "AAAA", mimeType: "image/jpeg" as const };

describe("fila offline de evidencias", () => {
  beforeEach(() => memoria.clear());

  it("enfileira e devolve a pendente da OS certa", async () => {
    await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-2", input);

    const daUm = await listarPendentesDaOs("os-1");
    expect(daUm).toHaveLength(1);
    expect(daUm[0].osId).toBe("os-1");
    expect(daUm[0].falhou).toBe(false);
  });

  it("gera localId unico por item", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    const b = await enfileirarEvidencia("os-1", input);
    expect(a.localId).not.toBe(b.localId);
  });

  it("remover tira so o item pedido", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-1", input);
    await removerPendenteParaTeste(a.localId);

    const restantes = await listarPendentesDaOs("os-1");
    expect(restantes).toHaveLength(1);
    expect(restantes[0].localId).not.toBe(a.localId);
  });

  it("falha marca o item em vez de descartar", async () => {
    // Descartar perderia a foto em silencio, que e o exato problema que a fila
    // existe pra evitar.
    const a = await enfileirarEvidencia("os-1", input);
    await marcarFalhouParaTeste(a.localId);

    const [pendente] = await listarPendentesDaOs("os-1");
    expect(pendente.localId).toBe(a.localId);
    expect(pendente.falhou).toBe(true);
  });

  it("sobrevive a storage corrompido, devolvendo fila vazia", async () => {
    memoria.set("isphub_evidencias_outbox", "{ isso nao e json");
    expect(await listarPendentesDaOs("os-1")).toEqual([]);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

```bash
cd apps/mobile && npm test
```

Esperado: FAIL — módulo `./outbox` não existe.

- [ ] **Step 8: Implementar a fila**

Cria `apps/mobile/src/features/evidencias/outbox.ts`:

```ts
import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { enviarEvidencia } from "./api";
import type { EvidenciaInput } from "./limites";

/**
 * Fila offline de fotos de evidencia. Mesmo desenho do outbox do chat
 * (features/chat/outbox.ts), com duas diferencas: agrupa por `osId`, e o item
 * guarda o base64 JA COMPRIMIDO — comprimir ao enfileirar, nao ao enviar, pra
 * fila nao reter o arquivo original inteiro no AsyncStorage.
 *
 * Existe porque tecnico em campo fica sem sinal o tempo todo, e envio direto
 * com erro visivel e, na pratica, foto perdida: ninguem repete depois.
 */
export interface EvidenciaPendente {
  localId: string;
  osId: string;
  input: EvidenciaInput;
  criadoEm: string;
  falhou: boolean;
}

const CHAVE = "isphub_evidencias_outbox";

async function lerFila(): Promise<EvidenciaPendente[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as EvidenciaPendente[]) : [];
  } catch {
    return [];
  }
}

async function salvarFila(fila: EvidenciaPendente[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE, JSON.stringify(fila)).catch(() => {});
}

export async function enfileirarEvidencia(osId: string, input: EvidenciaInput): Promise<EvidenciaPendente> {
  const fila = await lerFila();
  const pendente: EvidenciaPendente = {
    localId: `pendente-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    osId,
    input,
    criadoEm: new Date().toISOString(),
    falhou: false,
  };
  fila.push(pendente);
  await salvarFila(fila);
  return pendente;
}

export async function listarPendentesDaOs(osId: string): Promise<EvidenciaPendente[]> {
  return (await lerFila()).filter((p) => p.osId === osId);
}

async function removerPendente(localId: string): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.filter((p) => p.localId !== localId));
}

async function marcarFalhou(localId: string): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.map((p) => (p.localId === localId ? { ...p, falhou: true } : p)));
}

/** Expostos so pro teste — a tela nunca chama estes diretamente. */
export const removerPendenteParaTeste = removerPendente;
export const marcarFalhouParaTeste = marcarFalhou;

/**
 * Sobe a fila quando a rede volta. Falha marca `falhou` em vez de tentar pra
 * sempre — e o item FICA na fila, porque descartar perderia a foto em silencio.
 */
export function useProcessarFilaEvidencias(): void {
  const { token } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let ultimaConectividade: boolean | null = null;

    async function processar() {
      const fila = await lerFila();
      for (const pendente of fila.filter((p) => !p.falhou)) {
        try {
          await enviarEvidencia(pendente.osId, token, pendente.input);
          await removerPendente(pendente.localId);
          qc.invalidateQueries({ queryKey: ["evidencias", pendente.osId] });
        } catch {
          await marcarFalhou(pendente.localId);
        }
      }
    }

    const unsubscribe = NetInfo.addEventListener((state) => {
      const conectado = !!state.isConnected && state.isInternetReachable !== false;
      if (conectado && ultimaConectividade === false) void processar();
      ultimaConectividade = conectado;
    });

    void processar(); // app reaberto ja online, com fila da sessao anterior

    return () => unsubscribe();
  }, [token, qc]);
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

```bash
cd apps/mobile && npm test
```

Esperado: PASS, 14 testes no total.

- [ ] **Step 10: Typecheck**

```bash
cd apps/mobile && npm run typecheck
```

Esperado: sem erros.

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/src/features/evidencias
git commit -m "Evidencias: cliente da API e a fila que nao perde foto

A API ja fazia proxy das fotos pro SGP; faltava o lado do celular.

A fila guarda o base64 ja comprimido, nao o arquivo original, e falha de
envio marca o item em vez de descartar — descartar perderia a foto em
silencio, que e justamente o que a fila existe pra evitar.

A guarda de tamanho roda ao tirar a foto, nao ao enviar: estouro descoberto
so na hora do upload falharia longe dos olhos do tecnico. Ela mora em
limites.ts, sem imports, pra ser testavel sem mockar expo-file-system."
```

---

### Task 4: Evidências — galeria na tela da OS

Fecha o módulo: a grade de fotos, os botões de câmera e galeria, e o estado "aguardando envio" para o que está na fila.

**Files:**
- Create: `apps/mobile/src/features/evidencias/galeria.tsx`
- Modify: `apps/mobile/src/app/(app)/minhas-os/[id].tsx`

**Interfaces:**
- Consumes: `listarEvidencias`, `baixarEvidencia`, `cabeNoLimite`, `EvidenciaInput` (Task 3); `enfileirarEvidencia`, `listarPendentesDaOs`, `useProcessarFilaEvidencias` (Task 3); `useModuloHabilitado` (Task 1); `escolherFoto`, `comprimirImagem` de `@/features/chat/media`
- Produces: `<GaleriaEvidencias osId={string} />`

- [ ] **Step 1: Investigar a permissão de câmera ANTES de escrever código**

`android.permission.CAMERA` não aparece no `AndroidManifest.xml` gerado, embora o chat já chame `launchCameraAsync`. Há duas explicações possíveis e elas levam a caminhos diferentes.

No aparelho, abrir o chat e tirar uma foto:

```bash
~/Library/Android/sdk/platform-tools/adb devices
```

- **Funcionou** → o `expo-image-picker` usa intent do sistema, que dispensa a permissão. Nada a fazer; anotar o resultado no commit.
- **Falhou** → declarar `"android.permission.CAMERA"` no array `expo.android.permissions` do `app.json` na Task 5, e o dev client precisa ser **recompilado** (permissão é manifest, não vai por OTA).

Não presumir nenhum dos dois.

- [ ] **Step 2: Criar a galeria**

Cria `apps/mobile/src/features/evidencias/galeria.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { EvidenciaResumo } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Button, Muted, SectionLabel } from "@/components/ui";
import { colors, space } from "@/theme/tokens";
import { escolherFoto, comprimirImagem } from "@/features/chat/media";
import { baixarEvidencia, listarEvidencias } from "./api";
import { cabeNoLimite } from "./limites";
import { enfileirarEvidencia, listarPendentesDaOs, type EvidenciaPendente } from "./outbox";

const LADO_MINIATURA = 96;

/** Uma miniatura ja enviada. Precisa baixar com JWT — a listagem nao traz URL. */
function Miniatura({ osId, anexo }: { osId: string; anexo: EvidenciaResumo }) {
  const { token } = useAuth();
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    baixarEvidencia(osId, anexo.id, token)
      .then((local) => vivo && setUri(local))
      .catch(() => vivo && setUri(null));
    return () => {
      vivo = false;
    };
  }, [osId, anexo.id, token]);

  if (!uri) {
    return (
      <View style={{ width: LADO_MINIATURA, height: LADO_MINIATURA, borderRadius: 8, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Image source={{ uri }} style={{ width: LADO_MINIATURA, height: LADO_MINIATURA, borderRadius: 8 }} />;
}

/** Item ainda na fila: nao tem id do servidor, entao mostra estado em vez de imagem. */
function MiniaturaPendente({ pendente }: { pendente: EvidenciaPendente }) {
  return (
    <View
      style={{
        width: LADO_MINIATURA,
        height: LADO_MINIATURA,
        borderRadius: 8,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: pendente.falhou ? colors.danger : colors.border,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <Feather name={pendente.falhou ? "alert-circle" : "clock"} size={18} color={pendente.falhou ? colors.danger : colors.muted} />
      <Muted style={{ fontSize: 10, textAlign: "center" }}>{pendente.falhou ? "Falhou" : "Aguardando envio"}</Muted>
    </View>
  );
}

export function GaleriaEvidencias({ osId }: { osId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [pendentes, setPendentes] = useState<EvidenciaPendente[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const query = useQuery({
    queryKey: ["evidencias", osId],
    enabled: !!token && !!osId,
    queryFn: () => listarEvidencias(osId, token),
  });

  const recarregarPendentes = useCallback(() => {
    void listarPendentesDaOs(osId).then(setPendentes);
  }, [osId]);

  useEffect(recarregarPendentes, [recarregarPendentes, query.data]);

  async function adicionar(fonte: "camera" | "galeria") {
    setOcupado(true);
    try {
      const uri = await escolherFoto(fonte);
      if (!uri) return;

      const { base64, mime } = await comprimirImagem(uri);

      // Recusar AQUI, no ato: descobrir o estouro so quando a fila tentar subir
      // esconderia a falha do tecnico, longe do momento da foto.
      if (!cabeNoLimite(base64)) {
        Alert.alert("Foto muito grande", "Mesmo comprimida a foto passou do limite de 2 MB. Tente enquadrar mais de perto.");
        return;
      }

      await enfileirarEvidencia(osId, { dados: base64, mimeType: mime as "image/jpeg" });
      recarregarPendentes();
      qc.invalidateQueries({ queryKey: ["evidencias", osId] });
    } catch {
      Alert.alert("Não foi possível processar a foto", "Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  const enviadas = query.data ?? [];
  const vazio = enviadas.length === 0 && pendentes.length === 0;

  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel>Evidências</SectionLabel>

      {vazio && !query.isLoading ? (
        <Muted>Nenhuma foto anexada nesta OS.</Muted>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {enviadas.map((anexo) => (
            <Miniatura key={anexo.id} osId={osId} anexo={anexo} />
          ))}
          {pendentes.map((p) => (
            <MiniaturaPendente key={p.localId} pendente={p} />
          ))}
        </ScrollView>
      )}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Tirar foto"
          variant="ghost"
          icon={<Feather name="camera" size={16} color={colors.ink} />}
          loading={ocupado}
          onPress={() => void adicionar("camera")}
        />
        <Button
          label="Da galeria"
          variant="ghost"
          icon={<Feather name="image" size={16} color={colors.ink} />}
          loading={ocupado}
          onPress={() => void adicionar("galeria")}
        />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Montar a seção na tela da OS**

Em `apps/mobile/src/app/(app)/minhas-os/[id].tsx`, acrescentar aos imports:

```ts
import { GaleriaEvidencias } from "@/features/evidencias/galeria";
import { useProcessarFilaEvidencias } from "@/features/evidencias/outbox";
```

Junto dos outros gates (após a linha de `temChat`):

```ts
  const temEvidencias = useModuloHabilitado("evidencias");
  useProcessarFilaEvidencias();
```

E logo **antes** do bloco `{/* Anotacao */}` (por volta da linha 205):

```tsx
            {temEvidencias && <GaleriaEvidencias osId={id} />}
```

- [ ] **Step 4: Typecheck e testes**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Esperado: sem erros; 14 testes passando.

Se `colors.danger` ou `colors.border` não existirem em `@/theme/tokens`, o typecheck aponta — usar os tokens equivalentes que o arquivo define, sem inventar cor literal.

- [ ] **Step 5: Verificar no aparelho**

```bash
cd apps/mobile && npx expo start --dev-client
```

Subir o Metro **de dentro de `apps/mobile`** — rodado da raiz ele não lê o `.env` e o app cai em `http://localhost:4000` sem avisar. Conferir no log as duas primeiras linhas: `env: load .env` e `env: export EXPO_PUBLIC_API_URL`.

No aparelho, numa OS real: tirar foto, confirmar que aparece como "Aguardando envio", e que some da fila virando miniatura quando sobe. Depois desligar a rede, tirar outra, e confirmar que ela fica pendente e sobe sozinha ao religar.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/evidencias/galeria.tsx "apps/mobile/src/app/(app)/minhas-os/[id].tsx"
git commit -m "Evidencias: a galeria dentro da OS

Secao no detalhe da OS, nao aba: foto pertence sempre a uma OS, e e ali que
o tecnico esta quando termina o servico.

Miniatura baixa com JWT porque a listagem do SGP nao traz URL de imagem —
mesmo padrao do avatar do chat. Item da fila mostra estado em vez de imagem,
ja que ainda nao tem id do servidor."
```

---

### Task 5: Configuração do EAS Build

Prepara o empacotamento. O `app.json` está com a lista de permissões inteira duplicada (16 entradas onde deveriam ser 8) e `remote-notification` repetido — resíduo de edição anterior não commitada, que o prebuild da nuvem levaria para o manifest.

**Files:**
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/eas.json` (existe, não versionado)

- [ ] **Step 1: Desduplicar o `app.json`**

```bash
cd apps/mobile && python3 - <<'PY'
import json
from pathlib import Path

p = Path("app.json")
d = json.loads(p.read_text())
e = d["expo"]

perms = e["android"]["permissions"]
e["android"]["permissions"] = list(dict.fromkeys(perms))

modos = e["ios"]["infoPlist"]["UIBackgroundModes"]
e["ios"]["infoPlist"]["UIBackgroundModes"] = list(dict.fromkeys(modos))

# O canal de OTA sai do app.json: ele foi posto aqui porque build local nao le
# canal do eas.json. Com EAS Build o perfil manda, e manter o hardcode faria um
# build `preview` puxar update de `production` — erro que nao emite sinal nenhum.
e.get("updates", {}).pop("requestHeaders", None)

p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("permissions:", len(perms), "->", len(e["android"]["permissions"]))
print("UIBackgroundModes:", len(modos), "->", len(e["ios"]["infoPlist"]["UIBackgroundModes"]))
print("updates:", json.dumps(e.get("updates"), ensure_ascii=False))
PY
```

Esperado: `permissions: 16 -> 8`, `UIBackgroundModes: 2 -> 1`, e `updates` sem `requestHeaders`.

Se a Task 4 concluiu que a permissão de câmera é necessária, acrescentar `"android.permission.CAMERA"` ao array agora.

- [ ] **Step 2: Escrever o `eas.json` completo**

Substituir o conteúdo de `apps/mobile/eas.json` por:

```json
{
  "cli": {
    "version": ">= 16.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "http://localhost:4000" }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://api.isphub.net.br" }
    },
    "production": {
      "distribution": "internal",
      "channel": "production",
      "autoIncrement": true,
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://api.isphub.net.br" }
    }
  },
  "submit": {
    "production": {}
  }
}
```

O bloco `env` é o que impede o APK de sair apontando para `localhost`: `apps/mobile/.env` é gitignorado, o EAS Build só recebe o que está no git, e `src/lib/api.ts:9` faz `process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000"` — sem isso o build passa verde e o app não conecta.

`distribution: internal` no `production` é o que faz o EAS devolver página de instalação com QR em vez de um `.aab` de loja.

- [ ] **Step 3: Typecheck**

```bash
cd apps/mobile && npm run typecheck
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app.json apps/mobile/eas.json
git commit -m "EAS Build: desduplica o app.json e versiona os perfis

O app.json tinha 16 permissoes onde deveriam ser 8, a lista inteira repetida,
e remote-notification duas vezes — o prebuild da nuvem levaria isso pro
manifest.

O canal de OTA sai do app.json e passa a vir do perfil: mantido, um build
preview puxaria update de producao, e esse erro nao emite sinal nenhum.

O bloco env existe porque o .env e gitignorado. Sem ele o APK sairia
apontando pra localhost, com o build passando verde."
```

---

### Task 6: Build de produção e migração nos aparelhos

**Files:** nenhum — esta tarefa é operação e verificação.

- [ ] **Step 1: Disparar o build**

```bash
cd apps/mobile && npx eas-cli@latest build --platform android --profile production
```

O EAS vai perguntar sobre a keystore na primeira vez: escolher **gerar uma nova**, gerenciada por ele. É o que troca a chave de debug (`androiddebugkey`, pública e igual em toda instalação do Android SDK) por uma chave de produção de verdade.

O projeto nunca rodou build na nuvem, então a fila pode demorar bem mais que os ~11 min do build local. Não é erro; é espera.

- [ ] **Step 2: Provar que a URL de produção foi assada**

Baixar o APK pelo link que o EAS devolve e:

```bash
unzip -p <apk> assets/index.android.bundle | strings | grep -oE 'https://[a-z.]*isphub[a-z.]*' | sort -u
```

Esperado: apenas `https://api.isphub.net.br`. Se aparecer `localhost`, o bloco `env` da Task 5 não pegou — não distribuir.

- [ ] **Step 3: Provar que não é mais a chave de debug**

```bash
~/Library/Android/sdk/build-tools/*/apksigner verify --print-certs <apk>
```

Esperado: um certificado que **não** seja `CN=Android Debug`.

- [ ] **Step 4: Anotar o runtime version novo**

```bash
unzip -p <apk> assets/fingerprint
```

Guardar o valor: os updates OTA já publicados no branch `production` foram para o fingerprint antigo e **não** alcançam este APK. Nada se perde — o bundle embutido traz o código atual — mas o próximo `eas update` precisa ser republicado para valer aqui.

- [ ] **Step 5: Confirmar que o canal responde para esse fingerprint**

```bash
curl -s -D- -o /dev/null \
  -H "expo-platform: android" \
  -H "expo-runtime-version: <fingerprint>" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1" -H "accept: multipart/mixed" \
  https://u.expo.dev/43324a7a-92e3-42d7-8dbb-fd10f6bd7e2e
```

Esperado: 200 com `launchAsset` no corpo. Se der 404 `There is no channel named production`, criar o canal:

```bash
cd apps/mobile && npx eas-cli@latest channel:create production && npx eas-cli@latest channel:edit production --branch production
```

- [ ] **Step 6: Migrar os aparelhos, nesta ordem**

Dois aparelhos já têm o app: moto g22 (`ZF5242BSM5`) e Redmi 9 (`566fdc650404`). A assinatura mudou, então não dá para instalar por cima.

A ordem abaixo **contorna a trava de instalação da MIUI** porque não usa `adb` em passo nenhum:

1. Abrir o link de distribuição interna no navegador **do próprio aparelho** e baixar o APK
2. **Só com o arquivo já em Downloads**, desinstalar o app antigo
3. Tocar no APK baixado e instalar

Baixar antes de desinstalar não é conveniência: numa sessão anterior o app foi desinstalado primeiro, a trava da MIUI estava fechada, e o aparelho ficou sem o app.

O técnico perde a sessão e refaz o login. Nada além disso.

- [ ] **Step 7: Verificar no aparelho**

Abrir, logar, confirmar que a lista de OS carrega (prova que fala com `api.isphub.net.br`) e tirar uma foto de evidência numa OS real, confirmando que ela chega ao SGP.

- [ ] **Step 8: Commit de qualquer ajuste**

Se nenhum arquivo mudou nesta tarefa, não há commit — o entregável é o APK distribuído e verificado.

---

## Notas de execução

**O que NÃO fazer:**

- Não gatear `FolhaViatura` em `useModuloHabilitado("frota")`. Esconderia a viatura de todo técnico — `frota.rolesPadrao` não inclui `TECNICO` e o `/config` filtra por papel.
- Não acrescentar `frota` nem `linha-movel` a `ROTAS_MODULO`. Nenhum dos dois é aba.
- Não rodar `npx expo lint` como critério: está quebrado por incompatibilidade de `ts-api-utils` com o TypeScript do repo, e isso é anterior a este trabalho.
- Não subir o Metro da raiz do monorepo. Ele "funciona" mas não lê o `.env`, e o app cai em `http://localhost:4000` sem avisar.

**Estado do repositório ao começar:** há alterações não commitadas anteriores a este trabalho em `apps/mobile/package.json`, `apps/mobile/src/features/jornada/viatura.tsx` e `package-lock.json`. As de `viatura.tsx` **não** fazem parte deste escopo — não arrastar num commit sem falar com o usuário.
