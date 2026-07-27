// Metro num monorepo npm-workspaces: observar a raiz (pra resolver @isphub/shared
// e deps hoisted) e procurar node_modules do app e da raiz. Sem isso o bundler
// nao acha o pacote compartilhado nem o React unico.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
