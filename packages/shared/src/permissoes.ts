import { UserRole } from "./roles.js";

/**
 * Permissoes do SUPERVISOR (papel GESTOR) por area da operacao.
 *
 * `Usuario.permissoes` guarda `{ [area]: "ver" | "editar" }`:
 *  - null = acesso total — e como todo gestor sempre foi; nada muda pra eles;
 *  - area ausente = nenhum acesso (negacao por padrao, no molde do atendente);
 *  - "ver" = so GET/HEAD; "editar" = qualquer metodo.
 *
 * A checagem vale NA API (middleware/auth.ts), nao so no menu: esconder o botao
 * e conveniencia, quem barra e o servidor. Os caminhos sao os da API sem
 * prefixo (os routers sao montados na raiz — ver apps/api/src/app.ts).
 * O ADMIN nunca passa por aqui.
 */

export type NivelArea = "ver" | "editar";

export type AreaId =
  | "fila"
  | "despacho"
  | "agenda"
  | "escala"
  | "frota"
  | "indicadores"
  | "chat"
  | "chatClientes"
  | "provisionamento"
  | "preCadastro"
  | "equipe";

export type PermissoesGestor = Partial<Record<AreaId, NivelArea>>;

export interface DefinicaoArea {
  rotulo: string;
  /** Telas do painel (prefixo do caminho; "/" casa so exato). */
  web: string[];
  /** Rotas da API que a area possui: GET/HEAD com "ver", qualquer metodo com "editar". */
  api: RegExp[];
  /** Rotas de OUTRAS areas que estas telas precisam ler (so GET/HEAD). */
  leitura?: RegExp[];
  /** Nao existe "ver": ler sem poder responder nao faz sentido (o chat). */
  soEditar?: boolean;
}

export const AREAS: Record<AreaId, DefinicaoArea> = {
  fila: {
    rotulo: "Fila e OS",
    web: ["/", "/os", "/mapa", "/retiradas", "/pendentes"],
    api: [/^\/fila(\/|$)/, /^\/ordens-servico(\/|$)/, /^\/provedores\/[^/]+\/conexao(\/|$)/, /^\/sync\/minhas-os$/],
    // `/agenda/turno`: o modo rota da tela /mapa desenha as paradas da janela.
    leitura: [/^\/tecnicos$/, /^\/frota\/ordens-servico\/[^/]+\/veiculos$/, /^\/agenda\/turno$/],
  },
  despacho: {
    rotulo: "Despacho",
    web: ["/despacho"],
    api: [/^\/logistica(\/|$)/, /^\/ordens-servico\/[^/]+\/atribuir$/, /^\/agenda\/?$/],
    leitura: [
      /^\/fila(\/|$)/,
      /^\/ordens-servico(\/|$)/,
      /^\/tecnicos$/,
      /^\/agenda\/(vagas|turno)(\/|$)/,
      /^\/jornada\/escalas(\/|$)/,
      /^\/frota\/mapa$/,
    ],
  },
  agenda: {
    rotulo: "Agenda e marcar visita",
    web: ["/agenda", "/marcar-visita"],
    api: [/^\/agenda(\/|$)/, /^\/admin\/agenda(\/|$)/, /^\/ordens-servico\/[^/]+\/(atribuir|encerrar|conversa-cliente)$/],
    leitura: [/^\/fila(\/|$)/, /^\/ordens-servico(\/|$)/, /^\/tecnicos$/],
  },
  escala: {
    rotulo: "Escala e jornada",
    web: ["/escala"],
    api: [/^\/jornada\/(escalas|ativas)(\/|$)/, /^\/agenda\/(redistribuicao|redistribuir)$/],
    leitura: [/^\/frota\/veiculos$/, /^\/agenda\/(vagas|turno)(\/|$)/, /^\/fila(\/|$)/, /^\/tecnicos$/],
  },
  frota: {
    rotulo: "Frota",
    web: ["/frota"],
    api: [/^\/frota(\/|$)/],
  },
  indicadores: {
    rotulo: "Dashboard e produtividade",
    web: ["/dashboard", "/produtividade"],
    api: [/^\/dashboard(\/|$)/, /^\/produtividade(\/|$)/],
    leitura: [/^\/jornada\/ativas$/],
  },
  chat: {
    rotulo: "Chat interno",
    web: ["/chat"],
    // `(\/|$)`: nao pode casar `/chat-clientes`, que e outra area.
    api: [/^\/chat(\/|$)/],
    soEditar: true,
  },
  chatClientes: {
    rotulo: "Chat com clientes",
    web: ["/chat-clientes"],
    api: [/^\/chat-clientes(\/|$)/, /^\/ordens-servico\/[^/]+\/conversa-cliente$/],
  },
  provisionamento: {
    rotulo: "Provisionamento de ONU",
    web: ["/provisionamento"],
    api: [/^\/provedores\/[^/]+\/fttx(\/|$)/],
  },
  preCadastro: {
    rotulo: "Pré-cadastro",
    web: ["/pre-cadastro"],
    api: [/^\/pre-cadastro(\/|$)/],
    leitura: [/^\/agenda\/(vagas|proximas)$/],
  },
  equipe: {
    rotulo: "Equipe",
    web: ["/equipe"],
    api: [/^\/usuarios(\/|$)/],
  },
};

const AREA_IDS = Object.keys(AREAS) as AreaId[];

/** O basico da sessao, livre pra todo gestor: (metodo, caminho). */
export const API_SEMPRE_LIVRE: [RegExp, RegExp][] = [
  [/./, /^\/auth(\/|$)/],
  [/./, /^\/notificacoes(\/|$)/],
  [/^(GET|HEAD)$/, /^\/(hora|eventos|config|categorias|integracoes)(\/|$)/],
  [/^(GET|HEAD)$/, /^\/linha-movel\/minha$/],
  [/^(GET|HEAD)$/, /^\/provedores(\/[^/]+)?$/],
];

export const WEB_SEMPRE_LIVRE = ["/perfil"];

/** Papeis que o gestor pode cadastrar/editar (a equipe de campo e do provedor). */
export const PAPEIS_DA_EQUIPE: UserRole[] = [UserRole.TECNICO, UserRole.ATENDENTE, UserRole.VENDEDOR];

/** O gestor tem a area no modo pedido? `null` = acesso total. */
export function podeArea(p: PermissoesGestor | null, area: AreaId, modo: NivelArea): boolean {
  if (!p) return true;
  const nivel = p[area];
  if (!nivel) return false;
  if (modo === "editar" || AREAS[area].soEditar) return nivel === "editar";
  return true;
}

/** A rota da API (metodo + url, com ou sem query string) cabe nas permissoes? */
export function gestorPode(p: PermissoesGestor | null, metodo: string, url: string): boolean {
  if (!p) return true;
  const caminho = url.split("?")[0]!;
  if (API_SEMPRE_LIVRE.some(([m, c]) => m.test(metodo) && c.test(caminho))) return true;
  const casa = (rs: RegExp[] | undefined) => !!rs?.some((r) => r.test(caminho));
  if (metodo === "GET" || metodo === "HEAD") {
    return AREA_IDS.some((a) => podeArea(p, a, "ver") && (casa(AREAS[a].api) || casa(AREAS[a].leitura)));
  }
  return AREA_IDS.some((a) => podeArea(p, a, "editar") && casa(AREAS[a].api));
}

/** A tela do painel cabe nas permissoes? "/" casa so exato; o resto, o prefixo. */
export function podeRotaWeb(p: PermissoesGestor | null, pathname: string): boolean {
  if (!p) return true;
  const casa = (w: string) => (w === "/" ? pathname === "/" : pathname === w || pathname.startsWith(`${w}/`));
  if (WEB_SEMPRE_LIVRE.some(casa)) return true;
  return AREA_IDS.some((a) => podeArea(p, a, "ver") && AREAS[a].web.some(casa));
}

/**
 * Limpa o que veio do banco ou do formulario. Lixo vira `{}` (FECHA tudo, nunca
 * abre); `null` continua `null` (acesso total). So areas e niveis conhecidos;
 * "ver" numa area so-editar e descartado. A ordem das chaves segue `AREAS`, pra
 * duas permissoes iguais serializarem igual.
 */
export function normalizarPermissoes(x: unknown): PermissoesGestor | null {
  if (x === null) return null;
  if (typeof x !== "object" || Array.isArray(x)) return {};
  const bruto = x as Record<string, unknown>;
  const saida: PermissoesGestor = {};
  for (const a of AREA_IDS) {
    const nivel = bruto[a];
    if (nivel !== "ver" && nivel !== "editar") continue;
    if (AREAS[a].soEditar && nivel === "ver") continue;
    saida[a] = nivel;
  }
  return saida;
}

/**
 * Quem pode cadastrar/editar quem. ADMIN, todos. GESTOR, so a equipe de campo
 * e, se ele e limitado a provedores, atendente/vendedor so dos provedores dele
 * (o tecnico e da ISPhub, de todos).
 */
export function podeGerirUsuario(
  ator: { role: UserRole | string; provedores?: string[] },
  alvo: { role: UserRole | string; provedorId: string | null },
): boolean {
  if (ator.role === UserRole.ADMIN) return true;
  if (ator.role !== UserRole.GESTOR) return false;
  if (!(PAPEIS_DA_EQUIPE as string[]).includes(alvo.role)) return false;
  const doProvedor = alvo.role === UserRole.ATENDENTE || alvo.role === UserRole.VENDEDOR;
  if (doProvedor && ator.provedores?.length) return !!alvo.provedorId && ator.provedores.includes(alvo.provedorId);
  return true;
}
