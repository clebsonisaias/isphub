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
        // Rolldown (Vite 8): `manualChunks` em funcao arrastava modulos de app
        // pro chunk do leaflet e o index passava a pre-carrega-lo em toda
        // pagina. `advancedChunks` agrupa SO o que casa no teste.
        advancedChunks: {
          groups: [
            { name: "motion", test: /[\\/]node_modules[\\/](gsap|@gsap|framer-motion|motion-dom|motion-utils)[\\/]/ },
            // React primeiro: e o grupo que todo chunk importa — se outro vier antes,
            // o rolldown pode acomodar o core do React nele e o index pre-carrega-lo.
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: "leaflet", test: /[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/ },
            // Sem isto cada icone vira um chunk de 300 bytes (50 requisicoes).
            { name: "icons", test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
});
