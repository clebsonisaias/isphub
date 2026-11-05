import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  PAPEIS_DA_EQUIPE,
  UserRole,
  escopadoPorProvedor,
  normalizarPermissoes,
  podeGerirUsuario,
  type PermissoesGestor,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { hashPassword } from "../services/authService.js";
import { invalidarCacheSessao } from "../services/sessaoService.js";

/**
 * CRUD de usuarios (admin/gestor/tecnico/provedor). Tecnico e um usuario com
 * role=tecnico, sem vinculo com provedor — ver services/escopoService.ts.
 *
 * O ADMIN gere todos. O GESTOR (supervisor) gere so a EQUIPE: tecnico,
 * atendente e vendedor — e, se ele e limitado a provedores, atendente/vendedor
 * so desses provedores (`podeGerirUsuario`, packages/shared/permissoes.ts).
 * Admin e gestor nunca aparecem nem mudam pela mao dele, nem ele mesmo.
 * O gestor com areas definidas ainda precisa da area "equipe" (requireAuth).
 */
export const usuariosRouter = Router();

usuariosRouter.use(requireAuth);

const GERE_USUARIOS = requireRole(UserRole.ADMIN, UserRole.GESTOR);

/** 403 se quem chama nao pode gerir o usuario nesse estado (papel + provedor). */
function exigirGerir(req: Request, alvo: { role: UserRole | string; provedorId: string | null }) {
  if (!podeGerirUsuario(req.user!, alvo)) throw new HttpError(403, "Sem permissao para gerir este usuario");
}

/**
 * Quem o GESTOR enxerga na lista: so a equipe que ele pode gerir. Sem lista de
 * provedores, a equipe toda; com lista, todo tecnico (e da ISPhub, atende
 * todos) e atendente/vendedor so dos provedores dele.
 */
function equipeDoGestor(provedores: string[] | undefined): Prisma.UsuarioWhereInput {
  if (!provedores?.length) return { role: { in: PAPEIS_DA_EQUIPE } };
  return {
    OR: [
      { role: UserRole.TECNICO },
      { role: { in: [UserRole.ATENDENTE, UserRole.VENDEDOR] }, provedorId: { in: provedores } },
    ],
  };
}

const SELECT_PUBLICO = {
  id: true,
  nome: true,
  email: true,
  role: true,
  provedorId: true,
  ativo: true,
  criadoEm: true,
  provedoresPermitidos: true,
  permissoes: true,
} as const;

usuariosRouter.get(
  "/",
  GERE_USUARIOS,
  asyncHandler(async (req, res) => {
    const roleFiltro = req.query.role;
    const filtro: Prisma.UsuarioWhereInput =
      typeof roleFiltro === "string" && (Object.values(UserRole) as string[]).includes(roleFiltro)
        ? { role: roleFiltro as UserRole }
        : {};
    // O gestor so ve a equipe dele: `AND` pra o `?role=` nunca alargar o escopo.
    const where = req.user!.role === UserRole.ADMIN ? filtro : { AND: [filtro, equipeDoGestor(req.user!.provedores)] };
    const usuarios = await prisma.usuario.findMany({ where, select: SELECT_PUBLICO, orderBy: { nome: "asc" } });
    res.json(usuarios);
  }),
);

/** provedorId so faz sentido pra provedor e atendente; para os demais papeis fica sempre null. */
function normalizarProvedorId(role: UserRole, provedorId?: string | null): string | null {
  return escopadoPorProvedor(role) ? (provedorId ?? null) : null;
}

function validarProvedorObrigatorio(role: UserRole, provedorId: string | null) {
  if (escopadoPorProvedor(role) && !provedorId) {
    throw new HttpError(400, "provedorId e obrigatorio para os papeis provedor e atendente");
  }
}

/** Quantos admins ativos existem, exceto o id informado (pra checar antes de remover o ultimo). */
async function contarOutrosAdminsAtivos(excluirId: string): Promise<number> {
  return prisma.usuario.count({ where: { role: UserRole.ADMIN, ativo: true, id: { not: excluirId } } });
}

/**
 * Limites do supervisor (so papel GESTOR, so o ADMIN define): provedores que
 * ele enxerga (vazio = todos) e areas com nivel (null = acesso total).
 * Campo AUSENTE = nao mexe — o PUT que so troca `ativo` nao apaga limite.
 */
const limitesSchema = {
  provedoresPermitidos: z.array(z.string().uuid()).max(100).optional(),
  permissoes: z.record(z.string(), z.enum(["ver", "editar"])).nullable().optional(),
};

interface Limites {
  provedoresPermitidos?: string[];
  permissoes?: PermissoesGestor | null;
}

/** O que gravar dos limites. Papel que nao e gestor fica sem limite nenhum. */
async function limitesParaGravar(
  quemChama: UserRole,
  role: UserRole,
  b: { provedoresPermitidos?: string[]; permissoes?: Record<string, string> | null },
): Promise<Limites> {
  // Antes do papel: o gestor nunca manda limite, nem num tecnico (onde seria
  // ignorado) — quem manda esta tentando algo que nao e dele.
  const mexe = b.provedoresPermitidos !== undefined || b.permissoes !== undefined;
  if (mexe && quemChama !== UserRole.ADMIN) throw new HttpError(403, "So o administrador define os limites do gestor");
  if (role !== UserRole.GESTOR) return { provedoresPermitidos: [], permissoes: null };

  const limites: Limites = {};
  if (b.provedoresPermitidos !== undefined) {
    const lista = [...new Set(b.provedoresPermitidos)].sort();
    if (lista.length && (await prisma.provedor.count({ where: { id: { in: lista } } })) !== lista.length) {
      throw new HttpError(400, "Provedor inexistente na lista de provedores permitidos");
    }
    limites.provedoresPermitidos = lista;
  }
  if (b.permissoes !== undefined) limites.permissoes = normalizarPermissoes(b.permissoes);
  return limites;
}

/** Limites no formato do Prisma: `null` em coluna Json vira `DbNull` (SQL NULL). */
function limitesNoPrisma(l: Limites) {
  return {
    ...(l.provedoresPermitidos !== undefined ? { provedoresPermitidos: l.provedoresPermitidos } : {}),
    ...(l.permissoes !== undefined
      ? { permissoes: l.permissoes === null ? Prisma.DbNull : (l.permissoes as Prisma.InputJsonObject) }
      : {}),
  };
}

const criarSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  senha: z.string().min(8, "A senha deve ter pelo menos 8 caracteres"),
  role: z.nativeEnum(UserRole),
  provedorId: z.string().uuid().nullable().optional(),
  ...limitesSchema,
});

usuariosRouter.post(
  "/",
  GERE_USUARIOS,
  asyncHandler(async (req, res) => {
    const data = criarSchema.parse(req.body);
    const provedorId = normalizarProvedorId(data.role, data.provedorId);
    validarProvedorObrigatorio(data.role, provedorId);
    exigirGerir(req, { role: data.role, provedorId });
    const limites = await limitesParaGravar(req.user!.role, data.role, data);

    const senhaHash = await hashPassword(data.senha);
    const usuario = await prisma.usuario
      .create({
        data: { nome: data.nome, email: data.email, role: data.role, provedorId, senhaHash, ...limitesNoPrisma(limites) },
        select: SELECT_PUBLICO,
      })
      .catch((err) => {
        if (err?.code === "P2002") throw new HttpError(409, "Ja existe um usuario com esse e-mail");
        throw err;
      });
    res.status(201).json(usuario);
  }),
);

const atualizarSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  provedorId: z.string().uuid().nullable().optional(),
  ativo: z.boolean(),
  ...limitesSchema,
});

usuariosRouter.put(
  "/:id",
  GERE_USUARIOS,
  asyncHandler(async (req, res) => {
    const data = atualizarSchema.parse(req.body);
    const alvo = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw new HttpError(404, "Usuario nao encontrado");

    const provedorId = normalizarProvedorId(data.role, data.provedorId);
    validarProvedorObrigatorio(data.role, provedorId);
    // Os DOIS estados: o atual (gestor nao mexe em admin/gestor, nem em si) e o
    // novo (nao promove ninguem a admin/gestor nem leva pra provedor alheio).
    exigirGerir(req, alvo);
    exigirGerir(req, { role: data.role, provedorId });
    const limites = await limitesParaGravar(req.user!.role, data.role, data);

    const deixaDeSerAdminAtivo =
      alvo.role === UserRole.ADMIN && alvo.ativo && (data.role !== UserRole.ADMIN || !data.ativo);
    if (deixaDeSerAdminAtivo) {
      if (alvo.id === req.user!.sub) {
        throw new HttpError(400, "Voce nao pode remover seu proprio acesso de administrador");
      }
      if ((await contarOutrosAdminsAtivos(alvo.id)) === 0) {
        throw new HttpError(409, "Nao e possivel remover o ultimo administrador ativo");
      }
    }

    // Papel, provedor e `ativo` viajam DENTRO do token — mudar qualquer um
    // deles sem derrubar a sessao deixava o token antigo valendo com o valor
    // ANTIGO por ate 8h. Rebaixar um admin era o pior caso: o token dele
    // continuava passando por requireRole(ADMIN), e com ele dava pra criar um
    // novo admin — a demissao virava reescalada garantida.
    // Os limites do gestor nao vao no token (o requireAuth le do banco), mas
    // mudar o que ele enxerga derruba a sessao do mesmo jeito: o painel dele
    // montou o menu com os limites antigos.
    const limitesMudaram =
      (limites.provedoresPermitidos !== undefined &&
        [...alvo.provedoresPermitidos].sort().join() !== limites.provedoresPermitidos.join()) ||
      (limites.permissoes !== undefined &&
        JSON.stringify(normalizarPermissoes(alvo.permissoes ?? null)) !== JSON.stringify(limites.permissoes));
    const sessaoInvalidada =
      alvo.role !== data.role || alvo.provedorId !== provedorId || (alvo.ativo && !data.ativo) || limitesMudaram;

    const usuario = await prisma.usuario
      .update({
        where: { id: alvo.id },
        data: {
          nome: data.nome,
          email: data.email,
          role: data.role,
          provedorId,
          ativo: data.ativo,
          ...limitesNoPrisma(limites),
          ...(sessaoInvalidada ? { tokenVersion: { increment: 1 } } : {}),
        },
        select: SELECT_PUBLICO,
      })
      .catch((err) => {
        if (err?.code === "P2002") throw new HttpError(409, "Ja existe um usuario com esse e-mail");
        throw err;
      });
    // Limpa o cache SEMPRE, nao so quando a sessao foi invalidada. REATIVAR um
    // usuario nao incrementa tokenVersion (nao ha sessao pra derrubar), mas o
    // cache ainda guardava `ativo:false` — e ele ficava sem conseguir entrar
    // ate o TTL expirar. Pego rodando o fluxo de verdade, nao lendo o codigo.
    invalidarCacheSessao(alvo.id);
    res.json(usuario);
  }),
);

const resetSenhaSchema = z.object({
  novaSenha: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres"),
});

usuariosRouter.post(
  "/:id/senha",
  GERE_USUARIOS,
  asyncHandler(async (req, res) => {
    const { novaSenha } = resetSenhaSchema.parse(req.body);
    const alvo = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw new HttpError(404, "Usuario nao encontrado");
    // Trocar a senha de alguem e tomar a conta dele: so de quem se pode gerir.
    exigirGerir(req, alvo);
    const senhaHash = await hashPassword(novaSenha);
    // Reset feito pelo admin normalmente e resposta a conta comprometida ou
    // saida do funcionario: tem que derrubar as sessoes abertas.
    const usuario = await prisma.usuario
      .update({
        where: { id: req.params.id },
        data: { senhaHash, tokenVersion: { increment: 1 } },
        select: SELECT_PUBLICO,
      })
      .catch(() => {
        throw new HttpError(404, "Usuario nao encontrado");
      });
    invalidarCacheSessao(req.params.id);
    res.json(usuario);
  }),
);

/** Soft-delete (ativo=false) — OS e atribuicoes referenciam o usuario, nao da pra apagar de verdade. */
usuariosRouter.delete(
  "/:id",
  GERE_USUARIOS,
  asyncHandler(async (req, res) => {
    const alvo = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw new HttpError(404, "Usuario nao encontrado");
    exigirGerir(req, alvo);
    if (alvo.id === req.user!.sub) throw new HttpError(400, "Voce nao pode desativar sua propria conta");
    if (alvo.role === UserRole.ADMIN && alvo.ativo && (await contarOutrosAdminsAtivos(alvo.id)) === 0) {
      throw new HttpError(409, "Nao e possivel desativar o ultimo administrador ativo");
    }

    // Desativar tem que derrubar a sessao na hora. Sem o tokenVersion++, o
    // token de um tecnico ja desligado seguia valendo por ate 8h em TODAS as
    // rotas — incluindo as que escrevem no SGP do provedor.
    const usuario = await prisma.usuario.update({
      where: { id: alvo.id },
      data: { ativo: false, tokenVersion: { increment: 1 } },
      select: SELECT_PUBLICO,
    });
    invalidarCacheSessao(alvo.id);
    res.json(usuario);
  }),
);
