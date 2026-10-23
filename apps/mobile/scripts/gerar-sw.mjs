/*
 * Depois do `expo export -p web`: preenche o dist/sw.js (copiado de public/)
 * com a lista de arquivos do build (pré-carga), a versão (hash do conteúdo) e
 * a origem da API. Uso: node scripts/gerar-sw.mjs dist
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const dist = process.argv[2] ?? "dist";
const FORA = new Set(["sw.js", "serve.json"]);

const arquivos = [];
(function andar(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) andar(caminho);
    else arquivos.push(relative(dist, caminho).split("\\").join("/"));
  }
})(dist);

/*
 * O barril do @expo/vector-icons faz o export levar a fonte de TODOS os
 * conjuntos (~3,9 MB). Pre-carrega so os que o app importa; o resto, se um dia
 * for usado, entra no cache na primeira vez que carregar com sinal.
 */
const FONTES_USADAS = ["Feather", "Ionicons", "MaterialCommunityIcons"];
const fonteNaoUsada = (a) => a.endsWith(".ttf") && !FONTES_USADAS.some((f) => a.includes(`/Fonts/${f}.`));

const precache = arquivos.filter((a) => !FORA.has(a) && !a.endsWith(".map") && !fonteNaoUsada(a)).sort();
const hash = createHash("sha256");
for (const a of precache) hash.update(a).update(readFileSync(join(dist, a)));
const versao = hash.digest("hex").slice(0, 12);
const api = new URL(process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").origin;

// O index.html entra como "/": o `serve` redireciona /index.html -> / e o
// cache recusaria a resposta redirecionada na navegação.
const urls = precache.map((a) => (a === "index.html" ? "/" : `/${a}`));

const alvo = join(dist, "sw.js");
const fonte = readFileSync(alvo, "utf8");
const marcas = ['"__VERSAO__"', '"__API__"', "[] /* __PRECACHE__ */"];
for (const m of marcas) if (!fonte.includes(m)) throw new Error(`sw.js sem a marca ${m} — public/sw.js mudou?`);

writeFileSync(
  alvo,
  fonte
    .replace('"__VERSAO__"', JSON.stringify(versao))
    .replace('"__API__"', JSON.stringify(api))
    .replace("[] /* __PRECACHE__ */", JSON.stringify(urls)),
);
console.log(`sw.js: versão ${versao}, ${urls.length} arquivos na pré-carga, API ${api}`);
