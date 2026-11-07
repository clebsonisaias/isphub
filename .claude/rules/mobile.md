---
paths:
  - "apps/mobile/**"
---
# App mobile (apps/mobile)

- Expo + React Native com Expo Router (`src/app/`), funcionalidades em `src/features/`, utilitários em `src/lib/`. Sem lockfile próprio: o app é workspace da raiz. Dependência nova com `npx expo install` dentro de `apps/mobile`.
- Sessão só via `src/lib/token-store.ts` (SecureStore). Fotos e mensagens offline pelas outbox (`src/features/evidencias/outbox.ts`, `src/features/chat/outbox.ts`): nada pode sumir em erro de rede. GPS é carimbo opcional (`src/features/localizacao.ts`): nunca trava a ação.
- `runtimeVersion` por fingerprint: dependência nativa, plugin, permissão ou `app.json` exige novo EAS Build; o resto pode ir por EAS Update. Não rode `eas build`/`update`/`submit` sem pedido explícito.
- Verificação: `npm run typecheck -w @isphub/mobile` e `npm test -w @isphub/mobile` (só lógica pura; telas se conferem no aparelho). Revisor: `mobile-reviewer`.
