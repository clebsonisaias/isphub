// Aplica o tema antes do primeiro paint (evita flash do tema errado).
//
// Vive num arquivo proprio, e nao inline no index.html, de proposito: assim a
// CSP pode usar `script-src 'self'` SEM `'unsafe-inline'`. Isso e o que impede
// um documento blob: (criado na nossa origem a partir de bytes que vieram de
// terceiro) de executar script — a defesa em profundidade do proxy de anexos.
(function () {
  try {
    var salvo = localStorage.getItem("isphub_theme");
    var tema =
      salvo === "light" || salvo === "dark"
        ? salvo
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.theme = tema;
  } catch {
    // localStorage bloqueado (modo privado / cookies desligados) — segue no tema claro.
  }
})();
