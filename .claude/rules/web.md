---
paths:
  - "apps/web/**"
---
# Painel web (apps/web)

- React 19 + Vite + Tailwind 4 + shadcn/ui. Páginas em `src/pages/`, componentes em `src/components/` (primitivos shadcn em `src/components/ui/`), contextos em `src/context/`, clientes da API e utilitários em `src/lib/`.
- Antes de criar componente, procure um parecido em `src/components/` (`ErrorState`, `EmptyState`, `ProvedorBadge`, `StatusBadge`, `SlaBadge`…). Avisos com `useToast`; cores por token do tema (`src/index.css`).
- O escopo por provedor é da API; a tela não decide o que o usuário pode ver.
- O mesmo build roda no navegador, no app Capacitor (`capacitor.config.ts`, `android/`) e dentro do app Expo (modo app, `src/lib/modoApp.ts`). Mutação de OS offline passa pela outbox (`src/lib/offlineStorage.ts`, `src/lib/syncEngine.ts`).
- Verificação: `npm run typecheck -w @isphub/web`, `npm run lint -w @isphub/web`, `npm test -w @isphub/web`; mudou build/config/dependência, `npm run build -w @isphub/web`. Fluxo de despacho/agenda/login: `cd apps/web && npx playwright test e2e/<area>.spec.ts` (precisa do Postgres de dev).
