/** Versão do sistema, injetada em tempo de build (ver vite.config.ts). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
/** Data+hora do build (UTC, "AAAA-MM-DD HH:mm") — muda a cada deploy real. */
export const APP_BUILD_ID = typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";

/** Rótulo curto para exibir no cabeçalho/rodapé: "v1.0.0 · 2026-07-26 08:06". */
export const APP_VERSION_LABEL = `v${APP_VERSION} · ${APP_BUILD_ID}`;
