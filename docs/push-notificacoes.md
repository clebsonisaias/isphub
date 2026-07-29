# Notificações push (ISPhub Técnico)

O que o app avisa, como funciona e — no fim — **o que só você pode configurar**.

## O que dispara uma notificação

| Evento | Quem recebe | Toque leva para |
|---|---|---|
| Mensagem no chat interno | Participantes da conversa, exceto o autor e quem silenciou | A conversa |
| Mensagem de cliente no WhatsApp | O atendente que assumiu. Se ninguém assumiu: admin/gestor + quem abriu a conversa | A conversa do cliente |
| OS atribuída a um técnico | O técnico, exceto se ele mesmo se atribuiu | O detalhe da OS |

Três decisões que valem explicar:

- **Silenciar silencia o push também.** Se o push ignorasse o `silenciado`, o
  botão de silenciar não silenciaria nada — que é exatamente o que faz a pessoa
  desligar a notificação do app inteiro.
- **Conversa com dono avisa só o dono.** Tocar o celular da empresa toda a cada
  resposta de um cliente que já está sendo atendido é o caminho mais curto para
  a equipe desativar o app nas configurações do Android.
- **Reentrega não notifica de novo.** O webhook da Meta reentrega o mesmo evento;
  a ingestão é idempotente, mas sem uma guarda explícita cada reentrega tocaria
  todos os celulares pela *mesma* mensagem.

## Como está montado

- **API** — `services/pushService.ts` envia pelo Expo Push Service; os gatilhos
  ficam nos mesmos pontos que já emitiam SSE (`chatService`,
  `clienteChatService`, `writebackService`). Tokens ficam em `push_tokens`.
- **App** — `lib/push.ts` (permissão, token, rota do toque) e
  `features/notificacoes/push-hook.ts` (registro e navegação), montado uma vez
  em `(app)/_layout.tsx`.

Duas garantias deliberadas:

- **Push é best-effort e roda depois da escrita.** Nenhuma falha de notificação
  derruba o envio de uma mensagem ou a atribuição de uma OS. O trabalho acontece
  mesmo que o aviso não saia.
- **O token pertence ao APARELHO, não à pessoa.** Se outro técnico logar no
  mesmo celular, o registro troca de dono; o logout desregistra. Sem isso, quem
  saiu continuaria recebendo as conversas de quem entrou — cenário real em
  equipe que compartilha aparelho.

## ⚠️ O que falta — e só você pode fazer

Sem estes passos o app **não recebe push**: `obterTokenPush()` devolve `null`,
registra nada e segue funcionando normalmente (sem quebrar).

### ✅ Já feito — projeto EAS

O projeto já existe e o `projectId` já está no `app.json`:

- `@clebsonisaias/isphub-tecnico` — ID `43324a7a-92e3-42d7-8dbb-fd10f6bd7e2e`
- https://expo.dev/accounts/clebsonisaias/projects/isphub-tecnico

Serve para Android **e** iOS. Não precisa repetir.

### Android — reaproveitando o Firebase do Maxxi

O projeto Firebase da CITmax é o **`erp-citmax`** (o mesmo do Maxxi Equipe). Dá
para reusá-lo — mas **não basta copiar o `google-services.json` de lá**: aquele
arquivo só registra `br.com.citmax.cliente` e `br.com.citmax.equipe`. Com um
pacote não registrado, o plugin do Google Services **quebra o build** com
`No matching client found for package name`.

O ISPhub precisa entrar como um **terceiro app dentro do mesmo projeto**:

1. Console do Firebase → projeto **`erp-citmax`** → *Adicionar app* → Android
   → nome do pacote **exatamente**: `com.clebsonisaias.isphubtecnico`
   (apelido sugerido: "ISPhub Técnico"). SHA-1 não é necessário para push.

2. Baixar o `google-services.json` **novo** (vem com os três apps) e salvar em
   `apps/mobile/google-services.json`. Depois declarar no `app.json`, dentro de
   `expo.android`:
   ```json
   "googleServicesFile": "./google-services.json"
   ```

3. **Credencial FCM V1 para o Expo** — Firebase → Configurações do projeto →
   Contas de serviço → *Gerar nova chave privada*. Enviar ao Expo:
   ```bash
   cd apps/mobile && npx eas credentials
   ```
   → Android → *Google Service Account Key for Push Notifications V1*.
   É a mesma chave que serve o Maxxi: a conta de serviço pertence ao **projeto**,
   não ao app. Se já houver uma guardada, pode reusar.

4. **Recompilar** (o `google-services.json` entra no build nativo):
   ```bash
   cd apps/mobile && npx expo run:android
   ```

> **Por que não automatizei:** registrar o app exige permissão na API do
> Firebase, e a conta do `gcloud` desta máquina (`clebsoncitnetbr@gmail.com`)
> não tem `serviceusage.serviceUsageConsumer` em `erp-citmax`. Conceder esse
> papel mexeria no IAM de um projeto de produção — não é passo para automatizar
> por conta própria.

### iOS

Precisa de conta paga do Apple Developer.

1. O projeto EAS já existe (serve para as duas plataformas).
2. Gerar uma **APNs Key** (.p8) no portal da Apple e enviar com
   `npx eas credentials` → iOS → *Push Notifications Key*.
3. Recompilar. O `UIBackgroundModes: ["remote-notification"]` já está no
   `app.json`.

### Como saber se funcionou

Com o app aberto e logado, o log do Metro mostra um aviso se o token não saiu
(`[push] nao foi possivel obter o token`). Se saiu, dá para conferir no banco:

```bash
psql "$DATABASE_URL" -c "select plataforma, count(*) from push_tokens group by 1;"
```

E para testar o envio sem depender de um evento real, use a ferramenta do Expo
com o token da tabela: https://expo.dev/notifications

## Limitação conhecida

**Emulador não recebe push** — só aparelho físico. O código já detecta isso
(`Device.isDevice`) e não tenta obter token, para não poluir o log em dev.
