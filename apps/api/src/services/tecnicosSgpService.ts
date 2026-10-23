import { randomBytes } from "node:crypto";
import { OS_STATUS_ABERTOS, UserRole, chaveNome } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { hashPassword } from "./authService.js";
import { buildConnector } from "./erpConnectorService.js";
import { atribuirTecnico } from "./writebackService.js";

/**
 * Pessoas do SGP <-> usuarios do ISPhub, em dois papeis:
 * - tecnico: a lista de tecnicos do SGP (codigo, nome, login);
 * - atendente: quem registra OS no SGP. O SGP nao lista atendentes; so manda o
 *   LOGIN de quem abriu cada OS (`OrdemServico.usuario`), entao a lista sai dai.
 *
 * O SGP mistura usuario de sistema ("Hotspot", "sgp") com gente e escreve o
 * nome diferente da equipe ("JONATHAN" x "Thiago Jhonatan"). Entao o vinculo e
 * do admin: vincular a quem ja existe, criar um novo (sem login) ou ignorar.
 * So nome identico vincula sozinho.
 */

export const FUNCOES_CAMPO = ["tecnico", "auxiliar"] as const;
export type FuncaoCampo = (typeof FUNCOES_CAMPO)[number];
export const PAPEIS_SGP = ["tecnico", "atendente"] as const;
export type PapelSgp = (typeof PAPEIS_SGP)[number];

/** Quem registrou a OS mas nao e gente. */
const LOGINS_DE_SISTEMA = new Set(["sgp", "system", "sistema", "admin", "webchat", "hotspot", "easybi"]);
/** Janela da lista de atendentes: quem registrou OS nos ultimos N dias. */
const DIAS_ATENDENTES = 60;

/**
 * Cadastra um usuario SEM LOGIN: senha = segredo aleatorio que ninguem conhece,
 * e-mail placeholder em dominio .invalid. O admin libera o acesso depois em
 * /admin/usuarios (troca e-mail e senha).
 */
async function criarSemLogin(data: { nome: string; role: UserRole; funcaoCampo?: FuncaoCampo | null; provedorId?: string }) {
  const slug = chaveNome(data.nome).replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || data.role;
  let email = `${slug}@sem-login.isphub.invalid`;
  for (let n = 2; await prisma.usuario.findUnique({ where: { email }, select: { id: true } }); n++) {
    email = `${slug}.${n}@sem-login.isphub.invalid`;
  }
  return prisma.usuario.create({
    data: { ...data, email, senhaHash: await hashPassword(randomBytes(32).toString("hex")) },
    select: { id: true, nome: true },
  });
}

export const criarTecnicoSemLogin = (nome: string, funcao: FuncaoCampo | null = null) =>
  criarSemLogin({ nome, role: UserRole.TECNICO, funcaoCampo: funcao });

export const criarAtendenteSemLogin = (nome: string, provedorId: string) =>
  criarSemLogin({ nome, role: UserRole.ATENDENTE, provedorId });

/** Usuario do ISPhub com o MESMO nome (sem acento, caixa nem apelido) — e so se houver um. */
export function vinculoAutomatico(
  entrada: { nome: string | null; username: string | null },
  usuarios: { id: string; nome: string }[],
): string | null {
  const chave = chaveNome(entrada.nome ?? entrada.username ?? "");
  if (!chave) return null;
  const achados = usuarios.filter((t) => chaveNome(t.nome) === chave);
  return achados.length === 1 ? achados[0]!.id : null;
}

async function configSgp(provedorId: string) {
  const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
  if (!config) throw new HttpError(404, "Integracao SGP nao configurada para este provedor");
  return config;
}

/** Quem pode ser vinculado a um item desse papel. Atendente e do proprio provedor. */
function candidatosWhere(papel: PapelSgp, provedorId: string) {
  return papel === "atendente" ? { role: UserRole.ATENDENTE, provedorId } : { role: UserRole.TECNICO };
}

/** Grava a lista vinda do SGP. Nunca desfaz um vinculo ou um "ignorado" do admin. */
async function gravarLista(provedorId: string, papel: PapelSgp, lista: { sgpId: string; nome: string | null; username: string | null }[]) {
  const [usuarios, locais] = await Promise.all([
    prisma.usuario.findMany({ where: candidatosWhere(papel, provedorId), select: { id: true, nome: true } }),
    prisma.tecnicoSgp.findMany({ where: { provedorId, papel }, select: { sgpId: true, usuarioId: true, ignorado: true } }),
  ]);
  const localDe = new Map(locais.map((l) => [l.sgpId, l]));

  let novos = 0;
  let vinculados = 0;
  for (const t of lista) {
    const atual = localDe.get(t.sgpId);
    const auto = !atual?.usuarioId && !atual?.ignorado ? vinculoAutomatico(t, usuarios) : null;
    await prisma.tecnicoSgp.upsert({
      where: { provedorId_papel_sgpId: { provedorId, papel, sgpId: t.sgpId } },
      create: { provedorId, papel, sgpId: t.sgpId, nome: t.nome, username: t.username, usuarioId: auto },
      update: { nome: t.nome, username: t.username, ...(auto ? { usuarioId: auto } : {}) },
    });
    if (!atual) novos++;
    if (auto) vinculados++;
  }
  return { total: lista.length, novos, vinculadosAutomaticamente: vinculados };
}

/** Busca os tecnicos no SGP e atualiza a lista local. */
export async function sincronizarTecnicosSgp(provedorId: string) {
  const connector = buildConnector(await configSgp(provedorId));
  if (!connector.listTecnicos) throw new HttpError(400, "O ERP deste provedor nao lista tecnicos");
  return gravarLista(provedorId, "tecnico", await connector.listTecnicos());
}

/** Logins de quem registrou OS no espelho nos ultimos dias, sem os de sistema. */
export async function sincronizarAtendentesSgp(provedorId: string, agora = new Date()) {
  const desde = new Date(agora.getTime() - DIAS_ATENDENTES * 86_400_000);
  const grupos = await prisma.ordemServico.groupBy({
    by: ["usuario"],
    where: { provedorId, usuario: { not: null }, dataCadastro: { gte: desde } },
  });
  const logins = grupos.map((g) => g.usuario!.trim()).filter((l) => l && !LOGINS_DE_SISTEMA.has(l.toLowerCase()));
  return gravarLista(provedorId, "atendente", logins.map((l) => ({ sgpId: l, nome: null, username: l })));
}

const USUARIO_RESUMO = { id: true, nome: true, funcaoCampo: true, ativo: true } as const;
const ITEM = { id: true, papel: true, sgpId: true, nome: true, username: true, ignorado: true, usuario: { select: USUARIO_RESUMO } } as const;

export async function listarTecnicosSgp(provedorId: string, papel: PapelSgp = "tecnico") {
  const [itens, candidatos] = await Promise.all([
    prisma.tecnicoSgp.findMany({
      where: { provedorId, papel },
      orderBy: [{ ignorado: "asc" }, { nome: { sort: "asc", nulls: "last" } }, { username: "asc" }],
      select: ITEM,
    }),
    prisma.usuario.findMany({ where: candidatosWhere(papel, provedorId), orderBy: { nome: "asc" }, select: USUARIO_RESUMO }),
  ]);
  // `tecnicos` mantido no nome: e o que a tela ja le (para atendente, sao as atendentes).
  return { itens, tecnicos: candidatos };
}

export interface DecisaoTecnicoSgp {
  /** Vincula a um usuario existente (nulo desvincula). */
  usuarioId?: string | null;
  /** Cria um usuario novo, sem login, com o nome do SGP, e vincula. */
  criar?: boolean;
  /** Marca como "nao e gente da equipe" (desvincula) ou volta atras. */
  ignorado?: boolean;
  /** Funcao do tecnico vinculado (so papel tecnico). */
  funcao?: FuncaoCampo | null;
}

export async function decidirTecnicoSgp(provedorId: string, id: string, d: DecisaoTecnicoSgp) {
  const item = await prisma.tecnicoSgp.findFirst({ where: { id, provedorId } });
  if (!item) throw new HttpError(404, "Item do SGP nao encontrado neste provedor");
  const papel = item.papel as PapelSgp;

  let usuarioId = item.usuarioId;
  if (d.ignorado === true) usuarioId = null;
  if (d.criar) {
    const nome = item.nome ?? item.username ?? `SGP ${item.sgpId}`;
    usuarioId = (papel === "atendente" ? await criarAtendenteSemLogin(nome, provedorId) : await criarTecnicoSemLogin(nome, d.funcao ?? null)).id;
  } else if (d.usuarioId !== undefined) {
    if (d.usuarioId) {
      const u = await prisma.usuario.findFirst({ where: { id: d.usuarioId, ...candidatosWhere(papel, provedorId) }, select: { id: true } });
      if (!u) throw new HttpError(404, papel === "atendente" ? "Atendente do ISPhub nao encontrada neste provedor" : "Tecnico do ISPhub nao encontrado");
    }
    usuarioId = d.usuarioId;
  }

  await prisma.tecnicoSgp.update({
    where: { id },
    data: { usuarioId, ...(d.ignorado !== undefined ? { ignorado: d.ignorado } : {}), ...(d.criar || d.usuarioId ? { ignorado: false } : {}) },
  });
  if (d.funcao !== undefined && !d.criar) {
    if (papel !== "tecnico") throw new HttpError(400, "Funcao so vale para tecnico");
    if (!usuarioId) throw new HttpError(409, "Vincule a um tecnico antes de definir a funcao");
    await prisma.usuario.update({ where: { id: usuarioId }, data: { funcaoCampo: d.funcao } });
  }
  return prisma.tecnicoSgp.findUnique({ where: { id }, select: ITEM });
}

/** Origem gravada em `Atribuicao.atribuidoPor` quando o tecnico veio do SGP. */
export const ORIGEM_SGP = "sgp";
/** Origens automaticas que o SGP pode substituir. Tecnico posto por gente no ISPhub fica. */
const ORIGENS_SUBSTITUIVEIS = new Set([ORIGEM_SGP, "planilha"]);

export interface DespachoOs {
  tecnicoId: string | null;
  atribuidoPor: string | null | undefined;
  apoioIds: string[];
  responsavelSgp: string | null;
  auxiliaresSgp: string[];
}

/**
 * O que fazer com uma OS cujo SGP mostra tecnico/apoio (decisao pura).
 * `idDoLogin` traduz login do SGP -> usuario do ISPhub (so os vinculados).
 */
export function decidirDespachoSgp(os: DespachoOs, idDoLogin: (login: string) => string | undefined) {
  const titular = os.responsavelSgp ? idDoLogin(os.responsavelSgp) : undefined;
  let atribuir: string | null = null;
  let conflito = false;
  if (titular && titular !== os.tecnicoId) {
    if (!os.tecnicoId || ORIGENS_SUBSTITUIVEIS.has(os.atribuidoPor ?? "")) atribuir = titular;
    else conflito = true;
  }
  const titularFinal = atribuir ?? os.tecnicoId;
  const apoios = [...new Set(os.auxiliaresSgp.map(idDoLogin).filter((x): x is string => !!x && x !== titularFinal))];
  const mudouApoio = apoios.length !== os.apoioIds.length || apoios.some((a) => !os.apoioIds.includes(a));
  const semVinculo = [os.responsavelSgp, ...os.auxiliaresSgp].filter((l): l is string => !!l && !idDoLogin(l));
  return { atribuir, conflito, apoios: mudouApoio ? apoios : null, semVinculo };
}

/**
 * Espelha no ISPhub o tecnico e o apoio que a OS ja tem no SGP (pedido de
 * 23/10/2026). So OS abertas, so logins vinculados na aba "Tecnicos do SGP".
 * Tecnico posto por gente no ISPhub vence (vira conflito no log).
 * ponytail: tirar o tecnico no SGP nao desatribui aqui; fazer se a equipe pedir.
 */
export async function espelharDespachoSgp(provedorId: string) {
  const vinculos = await prisma.tecnicoSgp.findMany({
    where: { provedorId, papel: "tecnico", ignorado: false, usuarioId: { not: null } },
    select: { username: true, nome: true, usuarioId: true, usuario: { select: { ativo: true } } },
  });
  const porLogin = new Map<string, string>();
  for (const v of vinculos) {
    if (!v.usuario?.ativo) continue;
    for (const chave of [v.username, v.nome]) if (chave) porLogin.set(chave.trim().toLowerCase(), v.usuarioId!);
  }
  const idDoLogin = (login: string) => porLogin.get(login.trim().toLowerCase());

  const oss = await prisma.ordemServico.findMany({
    where: {
      provedorId,
      status: { in: OS_STATUS_ABERTOS },
      OR: [{ tecnicoSgpNome: { not: null } }, { tecnicosAuxiliaresSgp: { isEmpty: false } }, { apoios: { some: {} } }],
    },
    select: {
      id: true, tecnicoId: true, tecnicoSgpNome: true, tecnicosAuxiliaresSgp: true,
      apoios: { select: { id: true } },
      atribuicoes: { orderBy: { atribuidoEm: "desc" }, take: 1, select: { atribuidoPor: true } },
    },
  });

  const r = { atribuidas: 0, apoiosAtualizados: 0, conflitos: 0, semVinculo: new Set<string>() };
  for (const os of oss) {
    const d = decidirDespachoSgp(
      {
        tecnicoId: os.tecnicoId,
        atribuidoPor: os.atribuicoes[0]?.atribuidoPor,
        apoioIds: os.apoios.map((a) => a.id),
        responsavelSgp: os.tecnicoSgpNome,
        auxiliaresSgp: os.tecnicosAuxiliaresSgp,
      },
      idDoLogin,
    );
    d.semVinculo.forEach((l) => r.semVinculo.add(l));
    if (d.conflito) r.conflitos++;
    if (d.atribuir) {
      await atribuirTecnico(os.id, d.atribuir, null, ORIGEM_SGP);
      r.atribuidas++;
    }
    if (d.apoios) {
      await prisma.ordemServico.update({ where: { id: os.id }, data: { apoios: { set: d.apoios.map((id) => ({ id })) } } });
      r.apoiosAtualizados++;
    }
  }
  return { ...r, semVinculo: [...r.semVinculo].sort() };
}

/** Todos os provedores com SGP ativo — o job diario. Falha num provedor nao para os outros. */
export async function sincronizarTodosTecnicosSgp() {
  const configs = await prisma.erpConfig.findMany({ where: { tipo: "SGP", ativo: true }, select: { provedorId: true } });
  for (const { provedorId } of configs) {
    try {
      const r = await sincronizarTecnicosSgp(provedorId);
      const a = await sincronizarAtendentesSgp(provedorId);
      console.log(
        `[tecnicos-sgp] provedor ${provedorId}: tecnicos ${r.total} (${r.novos} novo(s), ${r.vinculadosAutomaticamente} vinculado(s)); ` +
          `atendentes ${a.total} (${a.novos} novo(s), ${a.vinculadosAutomaticamente} vinculado(s))`,
      );
    } catch (e) {
      console.error(`[tecnicos-sgp] provedor ${provedorId}:`, e instanceof Error ? e.message : e);
    }
  }
}
