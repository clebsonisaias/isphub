import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Data+hora do build (nao o commit — o build Docker do Coolify roda sem
    // .git no contexto, entao um hash de commit sempre caia no fallback
    // "dev"). Um timestamp muda a cada build real, sem depender de git
    // dentro do container — e o que garante que o badge de versao no
    // cabecalho reflete de fato o ultimo deploy.
    __APP_BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
