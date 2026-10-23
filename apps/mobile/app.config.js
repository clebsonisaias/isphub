/*
 * Ajustes do PWA do tecnico (build web) — so quando PWA=1 (script build:web e
 * Dockerfile.web). NAO podem ir no app.json: ele entra no fingerprint do
 * runtime nativo (runtimeVersion: fingerprint), e qualquer mudanca la deixaria
 * os APKs instalados sem OTA. Sem PWA=1 isto devolve o app.json intacto, e o
 * fingerprint nao muda.
 */
module.exports = ({ config }) => {
  if (process.env.PWA !== "1") return config;
  return {
    ...config,
    web: {
      ...config.web,
      // SPA: o modo "static" renderiza cada rota no Node durante o export e
      // esbarra em modulo nativo (expo-notifications, AsyncStorage).
      output: "single",
      name: "ISPhub Técnico",
      shortName: "ISPhub",
      lang: "pt-BR",
      description: "Ordens de serviço, rota do dia e encerramento em campo.",
      themeColor: "#4F46E5",
    },
  };
};
