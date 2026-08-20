# EAS Build de produção para o app do técnico

Data: 2026-08-20
Escopo: `apps/mobile` (app do técnico, `com.clebsonisaias.isphubtecnico`)

## Problema

O app do técnico existe e funciona, mas não tem um caminho de produção de
verdade. Hoje o binário distribuído é gerado assim:

```
./android/gradlew -p android assembleRelease
```

Isso tem três defeitos que só aparecem quando se olha de perto:

1. **O "release" é assinado com a keystore de debug.** `android/app/build.gradle`
   traz `release { signingConfig signingConfigs.debug }`, herdado do template do
   Expo (o próprio arquivo avisa: *"Caution! In production, you need to generate
   your own keystore file"*). A chave `androiddebugkey` é pública e igual em toda
   instalação do Android SDK — qualquer pessoa consegue assinar um APK que se
   passa por este app.
2. **Depende da máquina do Christian.** JDK, Android SDK e `adb` estão fora do
   PATH, o build leva ~11 min, e o APK sai só num lugar.
3. **A instalação passa por `adb`**, que a MIUI bloqueia de forma intermitente
   (ver `isphub-build-mobile` na memória).

## Objetivo

Passar a gerar o binário de produção no **EAS Build** (nuvem), assinado com uma
keystore de produção gerenciada pelo EAS, e distribuí-lo aos técnicos por link
interno com QR — sem loja, sem `adb`, sem depender do Mac.

## Fora de escopo

- Publicação na Play Store (exigiria perfil gerando `.aab`, conta de
  desenvolvedor, ficha e review — outro projeto).
- iOS.
- O deploy do ISPhub no Coolify novo (`170.82.252.195`), adiado nesta sessão:
  as portas 80/443 estão bloqueadas por firewall e isso não se resolve pela API
  do Coolify.

## Decisões

### D1 — A URL da API entra pelo bloco `env` do `eas.json`

`apps/mobile/src/lib/api.ts:9`:

```ts
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
```

`apps/mobile/.env` é gitignorado (`.gitignore:10` do próprio app e `.gitignore:9-11`
da raiz). **O EAS Build só recebe o que está no git**, então sem intervenção o APK
de produção sairia apontando para `http://localhost:4000` — e o build passaria
verde, sem nenhum aviso. O técnico veria apenas erro de rede.

Escolhido: declarar `EXPO_PUBLIC_API_URL` no bloco `env` de cada perfil do
`eas.json`, versionado.

Alternativas descartadas:
- **Variáveis de ambiente no servidor do EAS** (`eas env:create`): apropriado
  para segredo de verdade, mas some do repositório e vira mais uma fonte de
  divergência. O próprio `.env` documenta que `EXPO_PUBLIC_*` **não é segredo**
  ("qualquer um lê do APK").
- **Commitar `.env.production`**: o `.gitignore` da raiz barra `.env.*`; exigiria
  abrir exceção numa regra que existe para proteger segredos.

### D2 — Keystore de produção gerenciada pelo EAS

No primeiro build o EAS gera a keystore e passa a guardá-la; todo build seguinte
é assinado com ela.

Consequência aceita: **a assinatura muda**, então não é possível instalar por
cima do app atual. Os aparelhos que já têm o app precisam desinstalar antes
(ver "Migração nos aparelhos").

Alternativas descartadas:
- **Subir a keystore de debug para o EAS** preservaria a assinatura e dispensaria
  a desinstalação, mas eternizaria o defeito que este trabalho existe para
  corrigir.
- **Keystore própria guardada localmente**: mesma segurança, mas transfere ao
  usuário a responsabilidade de guardar arquivo e senhas; perder a chave impede
  atualizar o app pela loja no futuro.

### D3 — O canal de OTA sai do `app.json`

`app.json` hoje traz:

```json
"updates": {
  "url": "https://u.expo.dev/43324a7a-92e3-42d7-8dbb-fd10f6bd7e2e",
  "requestHeaders": { "expo-channel-name": "production" },
  "fallbackToCacheTimeout": 10000
}
```

O `requestHeaders` foi posto ali porque **build local não lê canal do `eas.json`**
(ver `isphub-ota` na memória). Com EAS Build isso vira defeito: um build
`preview` ou `development` continuaria pedindo updates do canal `production`, e
esse tipo de erro não emite sinal nenhum — o app simplesmente recebe o bundle
errado.

Escolhido: remover `requestHeaders`; o canal passa a vir do perfil do `eas.json`.
Mantidos `url` e `fallbackToCacheTimeout`.

Consequência aceita: `gradlew assembleRelease` deixa de produzir um binário com
canal de OTA. O gradlew continua servindo para compilar dev client (que é o único
motivo que resta para usá-lo).

### D4 — `versionCode` remoto com `autoIncrement`

`app.json` não define `android.versionCode`. Em vez de fixá-lo, o perfil
`production` usa `autoIncrement`, e o EAS mantém o contador. Fixar no arquivo
exigiria editar à mão a cada build, e o esquecimento produz dois binários com o
mesmo `versionCode` — que o Android trata como a mesma versão.

## Mudanças

### `apps/mobile/app.json`

1. **Desduplicar.** O arquivo está com 16 permissões Android onde deveriam ser 8
   (a lista inteira repetida) e `remote-notification` duas vezes em
   `ios.infoPlist.UIBackgroundModes`. Resíduo de uma edição anterior não
   commitada. Sem isso o prebuild da nuvem carrega a duplicação para o manifest.
2. **Remover** `expo.updates.requestHeaders` (D3).
3. Preservar: `runtimeVersion: { "policy": "fingerprint" }`, `updates.url`,
   `fallbackToCacheTimeout`, `version: "1.0.0"`, `owner`, `extra.eas.projectId`.

### `apps/mobile/eas.json`

Partindo do arquivo já rascunhado (ainda não versionado), acrescentar `env` a
cada perfil e `autoIncrement` ao de produção:

| perfil | `channel` | `EXPO_PUBLIC_API_URL` | `distribution` | outros |
|---|---|---|---|---|
| `development` | `development` | `http://localhost:4000` | `internal` | `developmentClient: true`, APK |
| `preview` | `preview` | `https://api.isphub.net.br` | `internal` | APK |
| `production` | `production` | `https://api.isphub.net.br` | `internal` | APK, `autoIncrement: true` |

`preview` aponta para produção de propósito: serve para validar o binário real
contra dados reais antes de distribuir.

Ressalva sobre `development`: num dev client o `EXPO_PUBLIC_*` que vale é o que o
Metro injeta ao iniciar, não o do build. O valor no perfil serve só como padrão
declarado; não é ele que decide para onde o dev client aponta.

`distribution: internal` no perfil de produção é o que faz o EAS devolver página
de instalação com QR, em vez de um `.aab` destinado à loja.

O arquivo deve ser **commitado** — hoje é `??` no `git status`.

## Migração nos aparelhos

Dois aparelhos já têm o app: moto g22 (`ZF5242BSM5`) e Redmi 9 (`566fdc650404`).
Como a assinatura muda, ambos precisam desinstalar antes de instalar.

A ordem abaixo é deliberada e **contorna a trava de instalação da MIUI**, porque
não usa `adb` em nenhum passo:

1. Abrir o link de distribuição interna no navegador **do próprio aparelho** e
   baixar o APK.
2. **Só com o arquivo já em Downloads**, desinstalar o app antigo.
3. Tocar no APK baixado e instalar.

Baixar antes de desinstalar não é detalhe de conveniência: numa sessão anterior o
app foi desinstalado primeiro, a trava da MIUI estava fechada, e o aparelho ficou
sem o app (registrado em `isphub-build-mobile`).

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

Além disso, no aparelho: abrir o app, logar, e confirmar que a lista de OS
carrega (prova que o app fala com `api.isphub.net.br`).

## Riscos e pontos de atenção

- **O fingerprint muda.** A política `fingerprint` deriva o `runtimeVersion` da
  configuração nativa, e este trabalho altera o `app.json` (desduplicação das
  permissões e remoção do `requestHeaders`) — logo o hash muda por construção,
  independentemente de onde o build rode. Os updates OTA
  já publicados no branch `production` foram para o fingerprint antigo e **não
  alcançam** o APK novo. Nada se perde — o bundle embutido no build já traz o
  código atual — mas o primeiro `eas update` após este build precisa ser
  republicado para valer no fingerprint novo.
- **Fila do EAS Build.** O projeto nunca rodou um build na nuvem
  (`build:list` volta vazio). O tempo de fila depende do plano da conta e pode
  ser bem maior que os ~11 min do build local. Não é erro; é espera.
- **A keystore passa a ser um ativo.** Uma vez gerada, ela é o que dá identidade
  ao app. Vale conferir que está acessível na conta EAS (`credentials`) antes de
  considerar o trabalho concluído.
- **`npx expo lint` no mobile está quebrado** por incompatibilidade de
  `ts-api-utils` com o TypeScript do repo. Não é regressão desta mudança e não
  bloqueia o build; a verificação usa typecheck e os testes, não o lint do mobile.

## Estado do repositório ao começar

`git status` traz alterações não commitadas anteriores a este trabalho:
`apps/mobile/app.json`, `apps/mobile/package.json`,
`apps/mobile/src/features/jornada/viatura.tsx`, `package-lock.json`, e o
`apps/mobile/eas.json` não versionado. As mudanças em `viatura.tsx` e
`package.json` **não** fazem parte deste escopo e não devem ser alteradas aqui;
decidir o que fazer com elas é assunto separado.
