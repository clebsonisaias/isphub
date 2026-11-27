/**
 * O MENU LATERAL do desktop: os grupos do desenho, na ordem do desenho.
 *
 * So ARRUMA os itens que o usuario ja pode ver — quem decide o que aparece
 * continua sendo o filtro de papel/modulo/permissao do AppShell. Rota que nao
 * estiver em grupo nenhum cai em "Gestão": item novo no NAV_ITEMS aparece no
 * menu mesmo que alguem esqueca de agrupa-lo aqui.
 */
export const GRUPOS_MENU: { titulo: string; rotas: string[] }[] = [
  { titulo: "Operação", rotas: ["/", "/despacho", "/mapa", "/pendentes", "/retiradas"] },
  { titulo: "Agenda", rotas: ["/marcar-visita", "/pre-cadastro", "/agenda", "/escala"] },
  { titulo: "Frota", rotas: ["/frota", "/frota/bi"] },
  { titulo: "Conversas", rotas: ["/chat", "/chat-clientes"] },
  { titulo: "Gestão", rotas: ["/dashboard", "/produtividade", "/provisionamento", "/equipe", "/financeiro", "/admin"] },
  { titulo: "Minha conta", rotas: ["/producao", "/perfil"] },
];
const GRUPO_PADRAO = "Gestão";

const POSICAO: Record<string, { grupo: number; ordem: number }> = {};
GRUPOS_MENU.forEach((g, grupo) => g.rotas.forEach((rota, ordem) => (POSICAO[rota] = { grupo, ordem })));
const INDICE_PADRAO = GRUPOS_MENU.findIndex((g) => g.titulo === GRUPO_PADRAO);

export function agruparMenu<T extends { to: string }>(itens: T[]): { titulo: string; itens: T[] }[] {
  const baldes: T[][] = GRUPOS_MENU.map(() => []);
  for (const item of itens) baldes[POSICAO[item.to]?.grupo ?? INDICE_PADRAO]!.push(item);
  return GRUPOS_MENU.map((g, i) => ({
    titulo: g.titulo,
    // Desconhecidos (sem ordem) vao pro fim do grupo, na ordem em que vieram.
    itens: baldes[i]!.sort((a, b) => (POSICAO[a.to]?.ordem ?? 99) - (POSICAO[b.to]?.ordem ?? 99)),
  })).filter((g) => g.itens.length > 0);
}

/** A rota do item e a pagina atual? `/admin` e `/frota` cobrem as subpaginas. */
export function rotaAtiva(to: string, caminho: string): boolean {
  if (to === "/admin") return caminho.startsWith("/admin");
  // `/frota/bi` e item proprio; o resto de /frota/* (mapa, veiculos) e "Frota".
  if (to === "/frota") return caminho === "/frota" || (caminho.startsWith("/frota/") && !caminho.startsWith("/frota/bi"));
  return caminho === to;
}
