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

### Android

1. **Projeto EAS** (dá o `projectId` que identifica o app no serviço de push):
   ```bash
   cd apps/mobile && npx eas init
   ```
   Isso grava `extra.eas.projectId` no `app.json`. Precisa de conta Expo (grátis).

2. **Projeto no Firebase** → adicionar app Android com o pacote exato:
   `com.clebsonisaias.isphubtecnico`
   Baixar o `google-services.json` e salvar em `apps/mobile/google-services.json`.
   Depois, declarar no `app.json`, dentro de `expo.android`:
   ```json
   "googleServicesFile": "./google-services.json"
   ```

3. **Credencial FCM V1 para o Expo** — no Firebase:
   Configurações do projeto → Contas de serviço → *Gerar nova chave privada*.
   Enviar ao Expo:
   ```bash
   cd apps/mobile && npx eas credentials
   ```
   → Android → *Google Service Account Key for Push Notifications V1*.

4. **Recompilar o app** (o `google-services.json` entra no build nativo):
   ```bash
   cd apps/mobile && npx expo run:android
   ```

### iOS

Precisa de conta paga do Apple Developer.

1. Mesmo `eas init` do passo 1 acima (serve para as duas plataformas).
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
