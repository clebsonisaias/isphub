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
