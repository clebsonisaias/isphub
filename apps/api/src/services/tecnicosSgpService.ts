import { randomBytes } from "node:crypto";
import { UserRole, chaveNome } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { hashPassword } from "./authService.js";
import { buildConnector } from "./erpConnectorService.js";

/**
 * Tecnicos do SGP <-> tecnicos do ISPhub.
 *
 * O SGP so devolve codigo, nome e login, mistura tecnico de campo com usuario de
 * sistema ("Hotspot", "Easy BI") e escreve o nome diferente da equipe ("JONATHAN"
 * x "Thiago Jhonatan"). Entao o vinculo e do admin: vincular a um tecnico que ja
 * existe, criar um novo (sem login) ou ignorar. So nome identico vincula sozinho.
 */

export const FUNCOES_CAMPO = ["tecnico", "auxiliar"] as const;
export type FuncaoCampo = (typeof FUNCOES_CAMPO)[number];

/**
 * Cadastra um tecnico SEM LOGIN: senha = segredo aleatorio que ninguem conhece,
 * e-mail placeholder em dominio .invalid. Serve pra receber OS e rota; o admin
 * libera o acesso depois em /admin/usuarios (troca e-mail e senha).
 */
export async function criarTecnicoSemLogin(nome: string, funcao: FuncaoCampo | null = null) {
  const slug = chaveNome(nome).replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "tecnico";
  let email = `${slug}@sem-login.isphub.invalid`;
  for (let n = 2; await prisma.usuario.findUnique({ where: { email }, select: { id: true } }); n++) {
    email = `${slug}.${n}@sem-login.isphub.invalid`;
  }
  return prisma.usuario.create({
    data: {
      nome,
      email,
      senhaHash: await hashPassword(randomBytes(32).toString("hex")),
      role: UserRole.TECNICO,
      funcaoCampo: funcao,
    },
    select: { id: true, nome: true },
  });
}

/** Tecnico do ISPhub com o MESMO nome (sem acento, caixa nem apelido) — e so se houver um. */
export function vinculoAutomatico(
  entrada: { nome: string | null; username: string | null },
  tecnicos: { id: string; nome: string }[],
): string | null {
  const chave = chaveNome(entrada.nome ?? entrada.username ?? "");
  if (!chave) return null;
  const achados = tecnicos.filter((t) => chaveNome(t.nome) === chave);
  return achados.length === 1 ? achados[0]!.id : null;
}

async function configSgp(provedorId: string) {
  const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
  if (!config) throw new HttpError(404, "Integracao SGP nao configurada para este provedor");
  return config;
}

/** Busca os tecnicos no SGP e atualiza a lista local. Nunca desfaz um vinculo ou um "ignorado" do admin. */
export async function sincronizarTecnicosSgp(provedorId: string) {
  const connector = buildConnector(await configSgp(provedorId));
  if (!connector.listTecnicos) throw new HttpError(400, "O ERP deste provedor nao lista tecnicos");
  const lista = await connector.listTecnicos();

  const [tecnicos, locais] = await Promise.all([
    prisma.usuario.findMany({ where: { role: UserRole.TECNICO }, select: { id: true, nome: true } }),
    prisma.tecnicoSgp.findMany({ where: { provedorId }, select: { sgpId: true, usuarioId: true, ignorado: true } }),
  ]);
  const localDe = new Map(locais.map((l) => [l.sgpId, l]));

  let novos = 0;
  let vinculados = 0;
  for (const t of lista) {
    const atual = localDe.get(t.sgpId);
    const auto = !atual?.usuarioId && !atual?.ignorado ? vinculoAutomatico(t, tecnicos) : null;
    await prisma.tecnicoSgp.upsert({
      where: { provedorId_sgpId: { provedorId, sgpId: t.sgpId } },
      create: { provedorId, sgpId: t.sgpId, nome: t.nome, username: t.username, usuarioId: auto },
      update: { nome: t.nome, username: t.username, ...(auto ? { usuarioId: auto } : {}) },
    });
    if (!atual) novos++;
    if (auto) vinculados++;
  }
  return { total: lista.length, novos, vinculadosAutomaticamente: vinculados };
}

const USUARIO_RESUMO = { id: true, nome: true, funcaoCampo: true, ativo: true } as const;

export async function listarTecnicosSgp(provedorId: string) {
  const [itens, tecnicos] = await Promise.all([
    prisma.tecnicoSgp.findMany({
      where: { provedorId },
      orderBy: [{ ignorado: "asc" }, { nome: { sort: "asc", nulls: "last" } }, { username: "asc" }],
      select: { id: true, sgpId: true, nome: true, username: true, ignorado: true, usuario: { select: USUARIO_RESUMO } },
    }),
    prisma.usuario.findMany({ where: { role: UserRole.TECNICO }, orderBy: { nome: "asc" }, select: USUARIO_RESUMO }),
  ]);
  return { itens, tecnicos };
}

export interface DecisaoTecnicoSgp {
  /** Vincula a um tecnico existente (nulo desvincula). */
  usuarioId?: string | null;
  /** Cria um tecnico novo, sem login, com o nome do SGP, e vincula. */
  criar?: boolean;
  /** Marca como "nao e tecnico de campo" (desvincula) ou volta atras. */
  ignorado?: boolean;
  /** Funcao do tecnico vinculado. */
  funcao?: FuncaoCampo | null;
}

export async function decidirTecnicoSgp(provedorId: string, id: string, d: DecisaoTecnicoSgp) {
  const item = await prisma.tecnicoSgp.findFirst({ where: { id, provedorId } });
  if (!item) throw new HttpError(404, "Tecnico do SGP nao encontrado neste provedor");

  let usuarioId = item.usuarioId;
  if (d.ignorado === true) usuarioId = null;
  if (d.criar) {
    const nome = item.nome ?? item.username ?? `Tecnico SGP ${item.sgpId}`;
    usuarioId = (await criarTecnicoSemLogin(nome, d.funcao ?? null)).id;
  } else if (d.usuarioId !== undefined) {
    if (d.usuarioId) {
      const u = await prisma.usuario.findUnique({ where: { id: d.usuarioId }, select: { role: true } });
      if (!u || u.role !== UserRole.TECNICO) throw new HttpError(404, "Tecnico do ISPhub nao encontrado");
    }
    usuarioId = d.usuarioId;
  }

  await prisma.tecnicoSgp.update({
    where: { id },
    data: { usuarioId, ...(d.ignorado !== undefined ? { ignorado: d.ignorado } : {}), ...(d.criar || d.usuarioId ? { ignorado: false } : {}) },
  });
  if (d.funcao !== undefined && !d.criar) {
    if (!usuarioId) throw new HttpError(409, "Vincule a um tecnico antes de definir a funcao");
    await prisma.usuario.update({ where: { id: usuarioId }, data: { funcaoCampo: d.funcao } });
  }
  return prisma.tecnicoSgp.findUnique({
    where: { id },
    select: { id: true, sgpId: true, nome: true, username: true, ignorado: true, usuario: { select: USUARIO_RESUMO } },
  });
}

/** Todos os provedores com SGP ativo — o job diario. Falha num provedor nao para os outros. */
export async function sincronizarTodosTecnicosSgp() {
  const configs = await prisma.erpConfig.findMany({ where: { tipo: "SGP", ativo: true }, select: { provedorId: true } });
  for (const { provedorId } of configs) {
    try {
      const r = await sincronizarTecnicosSgp(provedorId);
      console.log(`[tecnicos-sgp] provedor ${provedorId}: ${r.total} no SGP, ${r.novos} novo(s), ${r.vinculadosAutomaticamente} vinculado(s) sozinho(s)`);
    } catch (e) {
      console.error(`[tecnicos-sgp] provedor ${provedorId}:`, e instanceof Error ? e.message : e);
    }
  }
}
