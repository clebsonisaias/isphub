import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-at-least-16-characters-long",
      CRYPTO_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      NODE_ENV: "test",
    },
  },
});
