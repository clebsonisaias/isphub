import { UserRole } from "@isphub/shared";

/**
 * CADA PAPEL COMEÇA NO SEU TRABALHO — onde o app abre e em que ordem o menu
 * aparece, por papel. Lógica pura, com teste.
 *
 * O Painel continua em "/" (links como "/?q=…" dependem disso): o app só leva
 * para a tela do papel no login e quando alguém ENTRA pela raiz; dentro da
 * sessão, clicar em Painel abre o Painel.
 */

const INICIO: Partial<Record<UserRole, string>> = {
  [UserRole.ADMIN]: "/despacho",
  [UserRole.GESTOR]: "/despacho",
  [UserRole.ATENDENTE]: "/marcar-visita",
  [UserRole.VENDEDOR]: "/pre-cadastro",
};

/** A tela de trabalho do papel. Técnico e provedor: o Painel (as OS dele). */
export function inicioDoPapel(role: UserRole | string | undefined): string {
  return INICIO[role as UserRole] ?? "/";
}

/** Para onde ir depois do login: a página que pediu o login, ou a tela do papel se ela era a raiz. */
export function destinoDoLogin(role: UserRole, pedida: string | undefined): string {
  return !pedida || pedida === "/" ? inicioDoPapel(role) : pedida;
}

const DESPACHO = [
  "/despacho", "/", "/marcar-visita", "/agenda", "/mapa", "/chat", "/chat-clientes", "/pendentes", "/retiradas",
  "/escala", "/frota", "/produtividade", "/provisionamento", "/dashboard", "/frota/bi", "/financeiro",
];
const ORDEM: Partial<Record<UserRole, string[]>> = {
  [UserRole.ADMIN]: DESPACHO,
  [UserRole.GESTOR]: DESPACHO,
  [UserRole.ATENDENTE]: ["/marcar-visita", "/agenda", "/", "/pendentes"],
  [UserRole.VENDEDOR]: ["/pre-cadastro", "/producao", "/chat-clientes", "/chat", "/perfil"],
};

/** Itens do menu na ordem do trabalho do papel; o que não está na lista mantém a ordem original, no fim. */
export function ordenarPorPapel<T extends { to: string }>(itens: T[], role: UserRole | string | undefined): T[] {
  const ordem = ORDEM[role as UserRole];
  if (!ordem) return itens;
  const pos = (to: string) => {
    const i = ordem.indexOf(to);
    return i < 0 ? ordem.length : i;
  };
  return itens.map((item, i) => ({ item, i })).sort((a, b) => pos(a.item.to) - pos(b.item.to) || a.i - b.i).map((x) => x.item);
}

const FIXOS_PADRAO = ["/", "/agenda", "/mapa", "/chat", "/retiradas", "/dashboard", "/chat-clientes"];
const FIXOS: Partial<Record<UserRole, string[]>> = {
  [UserRole.ADMIN]: ["/despacho", "/", "/agenda", "/mapa", "/chat"],
  [UserRole.GESTOR]: ["/despacho", "/", "/agenda", "/mapa", "/chat"],
  [UserRole.ATENDENTE]: ["/marcar-visita", "/agenda", "/"],
  [UserRole.VENDEDOR]: ["/pre-cadastro", "/producao", "/chat-clientes", "/chat", "/perfil"],
};

/** Abas fixas da barra do celular, em ordem de preferência (ficam as que o perfil enxerga). */
export function fixosRodapeDoPapel(role: UserRole | string | undefined): string[] {
  return FIXOS[role as UserRole] ?? FIXOS_PADRAO;
}
