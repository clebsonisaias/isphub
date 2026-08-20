# App do técnico "na real" — módulos, evidências e build de produção

Data: 2026-08-20
Escopo: `apps/mobile` (`com.clebsonisaias.isphubtecnico`), com toques pontuais
em `packages/shared`.

> Revisão desta data: a primeira versão deste documento cobria só o EAS Build.
> Ao levantar o que faltava no app apareceram dois trabalhos que **precisam vir
> antes** do build — a razão está em "Por que esta ordem".

## Objetivo

Levar o app do técnico ao estado em que ele possa ser instalado e mantido como
produto de verdade: sem depender do Mac do Christian, assinado com chave de
produção, com o buraco funcional mais caro fechado (evidências fotográficas) e
com o sistema de módulos governando de fato o que aparece na tela.

## Por que esta ordem

A ordem é a decisão mais importante deste documento.

Trocar a assinatura do app obriga cada técnico a desinstalar e reinstalar
(ver Fase 3). Isso é aceitável **uma vez**. Fazer o build de produção primeiro e
só depois construir `evidencias` custaria essa migração **duas vezes**, porque:

- `android.permission.CAMERA` **não está** no `AndroidManifest.xml` gerado, mesmo
  com `expo-image-picker` configurado com `cameraPermission`;
- se `evidencias` exigir declarar essa permissão, isso é mudança de manifest —
  e mudança de manifest **não vai por OTA**, exige APK novo.

Logo: tudo que possa mexer no nativo entra antes do build. As Fases 1 e 2 são
JS e configuração; a Fase 3 empacota o resultado.

```
Fase 1  vazamento de módulos   (JS puro — é bug, não feature)
Fase 2  módulo evidencias      (JS; só o manifest pode mudar)
Fase 3  EAS Build de produção  (um APK, uma migração)
```

---

# Fase 1 — Fechar o vazamento do sistema de módulos

## Problema

`src/lib/modulo-registry.ts` estabelece uma regra boa: só vira tab o módulo
`habilitado ∩ implementado`, para que um módulo ligado no admin mas não
construído não vire tab morta. A regra funciona na direção que ela cobre.

O inverso escapou. Duas features recentes chegaram à tela **por fora** do motor
de módulos:

| feature | sintoma |
|---|---|
| `frota` | é um `ModuloId`, mas não está em `ROTAS_MODULO`. `FolhaViatura` renderiza em `minhas-os/index.tsx:195` **sem nenhuma checagem de `useModulos`** — desligar `frota` no admin não desliga nada. |
| `linha-movel` | não é `ModuloId`. `CartaoMinhaLinha` renderiza em `perfil.tsx:168`, fora do alcance de qualquer toggle. |

O efeito é pior do que "toggle inerte": o admin vê um interruptor que mente.

## Causa

`useModulos()` (`src/lib/config.tsx:30`) devolve a **lista** de módulos
habilitados. Isso serve à navegação, que itera a lista. Mas não existe forma
ergonômica de uma tela perguntar *"o módulo X está ligado?"* — então quem
renderiza um pedaço de UI dentro de outra tela simplesmente não perguntou.

## Mudanças

1. **`src/lib/config.tsx`** — acrescentar `useModuloHabilitado(id: ModuloId): boolean`,
   derivado da mesma lista de `useModulos` (sem nova requisição). É este helper
   que torna a checagem barata o bastante para ninguém pular. Ele também é o que
   a Fase 2 usa.
2. **`packages/shared/src/modulos.ts`** — promover `linha-movel` a `ModuloId`,
   com entrada em `MODULO_CATALOGO` (`core: false`, `rolesPadrao: [TECNICO]`).
   Não é core: o app funciona sem ele.
3. **`minhas-os/index.tsx`** — envolver `FolhaViatura` e o rótulo de viatura em
   `useModuloHabilitado("frota")`.
4. **`perfil.tsx`** — envolver `CartaoMinhaLinha` em `useModuloHabilitado("linha-movel")`.

`ROTAS_MODULO` **não** ganha entradas novas: `frota` e `linha-movel` são seções
dentro de outras telas, não tabs. Esse é justamente o caso que o registro não
cobria.

## Verificação

- Teste que, com o módulo desligado no `/config`, a seção não renderiza — um por
  módulo (`frota`, `linha-movel`).
- Teste que a guarda de core continua valendo: `minhas-os` presente mesmo com
  `/config` devolvendo lista vazia (comportamento já existente em
  `primeiroNaoVazio`, não pode regredir).

---

# Fase 2 — Módulo `evidencias`

## Problema

Um app de serviço de campo sem foto de evidência não fecha o ciclo do trabalho.
A API **já está pronta** — três rotas em
`apps/api/src/routes/ordensServico.ts:195-222`, fazendo proxy pro SGP sem cópia
local dos bytes:

| rota | o que faz |
|---|---|
| `POST /ordens-servico/:id/evidencias` | corpo `{ dados: <base64>, legenda? }`; 201 com a lista atualizada |
| `GET /ordens-servico/:id/evidencias` | lista os anexos da OS |
| `GET /ordens-servico/:id/evidencias/:anexoId/arquivo` | devolve os bytes |

Falta só o lado do celular.

## O que já existe e será reusado

Esta fase é barata porque quase tudo já foi resolvido em outro lugar:

| necessidade | já existe em |
|---|---|
| tirar foto / escolher da galeria | `escolherFoto` — `features/chat/media.ts:31-37` |
| comprimir preservando detalhe | `comprimirImagem` (1600px, qualidade 0.6) — `features/chat/media.ts:16`. O comentário em `features/perfil/media.ts` diz que esses números foram escolhidos **exatamente** para detalhe de evidência. |
| exibir imagem que exige JWT | `baixarAnexoAutenticado`, como em `useAvatarUri` (`features/chat/avatar.tsx:16`) |
| fila offline | padrão de `features/chat/outbox.ts` (108 linhas, AsyncStorage + reprocessamento) |
| detectar volta da rede | `@react-native-community/netinfo`, já instalado e em uso |

**Nenhum módulo nativo novo.** É o que permite que esta fase, se preciso, ainda
chegue por OTA depois — desde que o manifest não mude.

## Decisões

### D1 — Seção dentro do detalhe da OS, não tab

As fotos pertencem sempre a uma OS. A galeria e o botão de câmera vivem em
`minhas-os/[id].tsx`, junto das ações de fechamento — que é onde o técnico já
está quando termina o serviço. `ROTAS_MODULO` não ganha entrada; a visibilidade
sai de `useModuloHabilitado("evidencias")`, criado na Fase 1.

Descartado: tab própria listando pendências do dia. Duplicaria navegação que já
existe e dobraria a superfície a construir e testar agora. Pode voltar depois,
como incremento, se o uso pedir.

### D2 — Fila offline reusando o padrão do outbox

O técnico trabalha em campo, com frequência sem sinal. Envio direto com erro
visível é, na prática, foto perdida — ele não vai repetir mais tarde.

A foto entra numa fila local, aparece na galeria já marcada como *aguardando
envio*, e sobe sozinha quando a rede volta.

`features/evidencias/outbox.ts` espelha `chat/outbox.ts`, com duas diferenças:
a chave de agrupamento é `osId` (não `conversaId`), e o item guarda o base64 já
comprimido — comprimir na hora de enfileirar, não na hora de enviar, para que a
fila não retenha o arquivo original inteiro.

### D3 — Comprimir antes de enfileirar, e falhar cedo se não couber

A API recusa acima de **2 MB decodificados**
(`EVIDENCIA_TAMANHO_MAX_BYTES`, `ordensServico.ts:174`). `comprimirImagem` a
1600px/0.6 fica confortavelmente abaixo disso no caso normal, mas "normal" não é
garantia. Se o resultado comprimido ainda passar do limite, o app avisa **no ato
de tirar a foto** — não depois, quando a fila tentar subir e falhar longe dos
olhos do técnico.

## Estrutura

```
src/features/evidencias/
  api.ts        # as 3 rotas + tipo do anexo
  outbox.ts     # fila local por osId (espelha chat/outbox.ts)
  galeria.tsx   # grade de miniaturas + botão de câmera/galeria + estado pendente
```

Ligado em `minhas-os/[id].tsx` como uma seção, atrás de `useModuloHabilitado`.

## Permissão de câmera — a incógnita a resolver primeiro

`android.permission.CAMERA` não aparece no manifest gerado, embora o chat já
chame `launchCameraAsync` e o plugin declare `cameraPermission`.

Há duas explicações possíveis e elas levam a caminhos diferentes:

- o `expo-image-picker` usa intent do sistema (`ACTION_IMAGE_CAPTURE`), que
  dispensa a permissão — nada a fazer; **ou**
- a câmera do chat está quebrada em silêncio no Android hoje.

**Primeiro passo da fase, antes de escrever código:** abrir o chat no aparelho e
tirar uma foto. O resultado decide se o manifest muda. Não presumir nenhum dos
dois — foi exatamente por não presumir que esta fase ficou antes do build.

## Verificação

- Testes da fila: enfileira offline → aparece como pendente → volta a rede →
  sobe → sai da fila. Falha de envio mantém o item, não o descarta.
- Teste da guarda de tamanho: imagem que comprime acima de 2 MB é recusada no
  ato, com mensagem.
- No aparelho: tirar foto numa OS real, confirmar que aparece na lista, e
  confirmar que ela chegou ao SGP (via `GET /:id/evidencias`).

---

# Fase 3 — EAS Build de produção

## Problema

O binário distribuído hoje sai de `./android/gradlew -p android assembleRelease`,
com três defeitos:

1. **O "release" é assinado com a keystore de debug.**
   `android/app/build.gradle` traz `release { signingConfig signingConfigs.debug }`,
   herdado do template do Expo — o próprio arquivo avisa *"Caution! In production,
   you need to generate your own keystore file"*. A chave `androiddebugkey` é
   pública e idêntica em toda instalação do Android SDK: qualquer pessoa
   consegue assinar um APK que se passa por este app.
2. **Depende de uma máquina.** JDK, Android SDK e `adb` estão fora do PATH; o
   build leva ~11 min e sai num lugar só.
3. **A instalação passa por `adb`**, que a MIUI bloqueia de forma intermitente.

## Decisões

### D1 — A URL da API entra pelo bloco `env` do `eas.json`

`src/lib/api.ts:9`:

```ts
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
```

`apps/mobile/.env` é gitignorado. **O EAS Build só recebe o que está no git**,
então, sem intervenção, o APK de produção sairia apontando para
`http://localhost:4000` — com o build passando verde, sem aviso nenhum. O técnico
veria apenas erro de rede.

Descartados: variáveis no servidor do EAS (some do repositório e vira fonte de
divergência; o próprio `.env` documenta que `EXPO_PUBLIC_*` **não é segredo** —
"qualquer um lê do APK"); e commitar `.env.production` (o `.gitignore` da raiz
barra `.env.*`, e essa regra existe para proteger segredos).

### D2 — Keystore de produção gerenciada pelo EAS

No primeiro build o EAS gera a keystore e passa a guardá-la.

Descartados: subir a keystore de debug (preservaria a assinatura e dispensaria a
desinstalação, mas eternizaria o defeito que esta fase existe para corrigir);
keystore própria guardada localmente (mesma segurança, mas transfere ao usuário
a responsabilidade pelo arquivo e senhas — perdê-la impede atualizar o app pela
loja no futuro).

### D3 — O canal de OTA sai do `app.json`

`updates.requestHeaders."expo-channel-name": "production"` foi posto ali porque
build local não lê canal do `eas.json`. Com EAS Build isso vira defeito: um build
`preview` continuaria pedindo updates de `production`, e esse erro não emite
sinal — o app recebe o bundle errado e ninguém percebe.

Removido; o canal passa a vir do perfil. `updates.url` e
`fallbackToCacheTimeout` ficam. Consequência aceita: `gradlew assembleRelease`
deixa de produzir binário com OTA — o gradlew segue servindo para dev client,
que é o motivo que resta para usá-lo.

### D4 — `versionCode` remoto com `autoIncrement`

`app.json` não define `android.versionCode`. Fixá-lo exigiria editar à mão a cada
build, e o esquecimento produz dois binários com o mesmo `versionCode` — que o
Android trata como a mesma versão. O EAS mantém o contador.

## Mudanças

### `apps/mobile/app.json`

1. **Desduplicar.** O arquivo está com 16 permissões Android onde deveriam ser 8
   (a lista inteira repetida) e `remote-notification` duas vezes em
   `ios.infoPlist.UIBackgroundModes` — resíduo de uma edição anterior não
   commitada. Sem isso, o prebuild da nuvem leva a duplicação para o manifest.
2. **Remover** `expo.updates.requestHeaders` (D3).
3. Declarar `android.permission.CAMERA` **se e somente se** a investigação da
   Fase 2 mostrar que é necessária.
4. Preservar: `runtimeVersion: { "policy": "fingerprint" }`, `updates.url`,
   `fallbackToCacheTimeout`, `version: "1.0.0"`, `owner`, `extra.eas.projectId`.

### `apps/mobile/eas.json`

Partindo do arquivo já rascunhado (hoje `??` no `git status`, precisa ser
commitado), acrescentar `env` a cada perfil e `autoIncrement` ao de produção:

| perfil | `channel` | `EXPO_PUBLIC_API_URL` | `distribution` | outros |
|---|---|---|---|---|
| `development` | `development` | `http://localhost:4000` | `internal` | `developmentClient: true`, APK |
| `preview` | `preview` | `https://api.isphub.net.br` | `internal` | APK |
| `production` | `production` | `https://api.isphub.net.br` | `internal` | APK, `autoIncrement: true` |

`preview` aponta para produção de propósito: serve para validar o binário real
contra dados reais antes de distribuir. **Isso significa que um build de teste
escreve no SGP de verdade** — ponto levantado ao usuário, mantido conscientemente.

Ressalva sobre `development`: num dev client, o `EXPO_PUBLIC_*` que vale é o que
o Metro injeta ao iniciar, não o do build. O valor no perfil é padrão declarado,
não é ele que decide para onde o dev client aponta.

`distribution: internal` no perfil de produção é o que faz o EAS devolver página
de instalação com QR, em vez de um `.aab` destinado à loja.

## Migração nos aparelhos

Dois aparelhos já têm o app: moto g22 (`ZF5242BSM5`) e Redmi 9 (`566fdc650404`).
Como a assinatura muda, ambos precisam desinstalar antes de instalar.

A ordem abaixo é deliberada e **contorna a trava de instalação da MIUI**, porque
não usa `adb` em passo nenhum:

1. Abrir o link de distribuição interna no navegador **do próprio aparelho** e
   baixar o APK.
2. **Só com o arquivo já em Downloads**, desinstalar o app antigo.
3. Tocar no APK baixado e instalar.

Baixar antes de desinstalar não é conveniência: numa sessão anterior o app foi
desinstalado primeiro, a trava da MIUI estava fechada, e o aparelho ficou sem o
app.

Efeito para o técnico: perde a sessão e refaz o login. Nada além disso.

## Verificação

Nenhuma afirmação de "está pronto" sem estas saídas na tela:

| o que provar | comando |
|---|---|
| a URL de produção está assada no bundle (e não `localhost`) | `unzip -p <apk> assets/index.android.bundle \| strings \| grep -oE 'https://[a-z.]*isphub[a-z.]*'` |
| não é mais a chave de debug | `apksigner verify --print-certs <apk>` |
| runtime version do binário novo | `unzip -p <apk> assets/fingerprint` |
| o canal `production` responde para esse fingerprint | a sonda abaixo — 200 com `launchAsset` no corpo |

```
curl -s -D- -o /dev/null \
  -H "expo-platform: android" \
  -H "expo-runtime-version: <fingerprint>" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1" -H "accept: multipart/mixed" \
  https://u.expo.dev/43324a7a-92e3-42d7-8dbb-fd10f6bd7e2e
```

No aparelho: abrir, logar, confirmar que a lista de OS carrega (prova que fala
com `api.isphub.net.br`) e tirar uma foto de evidência numa OS real.

---

## Fora de escopo

- Publicação na Play Store (exigiria perfil gerando `.aab`, conta de
  desenvolvedor, ficha e review).
- iOS.
- Os módulos `rota`, `assinatura` e `retiradas` — não têm tela **nem backend
  dedicado**; são projetos próprios.
- Tela de caixa de notificações (hoje só o `push-hook.ts` está ligado).
- O deploy do ISPhub no Coolify novo (`170.82.252.195`): as portas 80/443 estão
  bloqueadas por firewall, o que não se resolve pela API do Coolify. Adiado a
  pedido do usuário.

## Riscos e pontos de atenção

- **O fingerprint muda.** A política `fingerprint` deriva o `runtimeVersion` da
  configuração nativa, e este trabalho altera o `app.json` — logo o hash muda por
  construção. Os updates OTA já publicados no branch `production` foram para o
  fingerprint antigo e **não alcançam** o APK novo. Nada se perde (o bundle
  embutido traz o código atual), mas o primeiro `eas update` posterior precisa
  ser republicado para valer no fingerprint novo.
- **Fila do EAS Build.** O projeto nunca rodou build na nuvem (`build:list` volta
  vazio). O tempo de fila depende do plano da conta e pode superar bastante os
  ~11 min do build local. Não é erro; é espera.
- **A keystore vira um ativo.** Uma vez gerada, é ela que dá identidade ao app.
  Conferir que está acessível na conta EAS (`credentials`) antes de dar o
  trabalho por concluído.
- **`npx expo lint` no mobile está quebrado** por incompatibilidade de
  `ts-api-utils` com o TypeScript do repo. Não é regressão desta mudança e não
  bloqueia o build; a verificação usa typecheck e testes, não o lint do mobile.
- **Promover `linha-movel` a `ModuloId` mexe em `packages/shared`**, consumido
  também por `apps/api` e `apps/web`. A união é fechada por design, então o
  typecheck acusa qualquer ponto que precise acompanhar — mas o `/admin/modulos`
  na web passará a listar o módulo novo, e isso é mudança visível.

## Estado do repositório ao começar

`git status` traz alterações não commitadas anteriores a este trabalho:
`apps/mobile/app.json`, `apps/mobile/package.json`,
`apps/mobile/src/features/jornada/viatura.tsx`, `package-lock.json`, e o
`apps/mobile/eas.json` não versionado. As mudanças em `viatura.tsx` e
`package.json` **não** fazem parte deste escopo; decidir o que fazer com elas é
assunto separado, a resolver com o usuário antes de commitar qualquer coisa que
as arraste junto.
