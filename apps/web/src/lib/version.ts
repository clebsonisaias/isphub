/** Versão do sistema, injetada em tempo de build (ver vite.config.ts). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
export const APP_COMMIT = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev";
export const APP_BUILD_DATE = typeof __APP_BUILD_DATE__ !== "undefined" ? __APP_BUILD_DATE__ : "";

/** Rótulo curto para exibir no rodapé/menu: "v1.0.0 · a1b2c3d". */
export const APP_VERSION_LABEL = `v${APP_VERSION} · ${APP_COMMIT}`;
