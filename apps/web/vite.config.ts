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
  build: {
    rollupOptions: {
      output: {
        // Vendors estaveis em chunks proprios: mudam so quando a dependencia
        // sobe, entao o navegador reaproveita entre deploys. As paginas ja
        // se separam sozinhas pelo lazy() do App.
        // Forma de funcao: o Vite 8 (rolldown) nao aceita mais o objeto.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const pacote = id.split(/[\\/]node_modules[\\/]/).pop()?.split(/[\\/]/).slice(0, id.includes("/node_modules/@") ? 2 : 1).join("/") ?? "";
          if (["leaflet", "react-leaflet"].includes(pacote)) return "leaflet";
          if (["gsap", "@gsap/react", "framer-motion", "motion-dom", "motion-utils"].includes(pacote)) return "motion";
          if (["react", "react-dom", "react-router", "react-router-dom", "scheduler"].includes(pacote)) return "react";
          // Sem isto cada icone vira um chunk de 300 bytes (50 requisicoes).
          if (pacote === "lucide-react") return "icons";
        },
      },
    },
  },
});
