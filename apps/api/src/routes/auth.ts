import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { StatusPreset, UserRole, normalizarPermissoes, type UsuarioPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { hashPassword, signToken, validarFotoPerfil, verifyPassword } from "../services/authService.js";
import { invalidarCacheSessao } from "../services/sessaoService.js";
import {
  emitirRefresh,
  revogarRefresh,
  revogarTudoDoUsuario,
  rotacionarRefresh,
  type ContextoSessao,
} from "../services/refreshService.js";
import { redefinirSenha, solicitarRecuperacao } from "../services/recuperacaoSenhaService.js";

export const authRouter = Router();

/**
 * Limita tentativas de login para dificultar credential stuffing/brute force.
 *
 * A chave e `ip + email`, NAO so o IP: com a API atras do proxy do Coolify,
 * a chave por IP colocava a operacao inteira num balde unico — 10 tentativas
 * erradas de um desconhecido travavam o login de todos os tecnicos por 15 min,
 * e o atacante real dividia o mesmo balde com as vitimas (nenhuma protecao de
 * verdade). Combinar com `app.set("trust proxy", 1)` em app.ts.
 *
 * `skipSuccessfulRequests`: quem acerta a senha nao consome o balde — assim
 * um tecnico que erra uma vez e acerta na segunda nunca fica preso.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip ?? "");
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return `${ip}:${email}`;
  },
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." },
});

/**
 * Renovacao e rota publica (o access token vencido e justamente o motivo de
 * chamar), entao o teto e por IP e generoso: um navegador com varias abas
 * renova legitimamente algumas vezes seguidas. Serve so pra impedir alguem de
 * chutar refresh tokens em volume.
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." },
});

/**
 * Recuperacao de senha: apertado de proposito. Cada pedido dispara um e-mail
 * pra caixa de outra pessoa, entao o abuso aqui nao e so carga — e usar o
 * sistema pra incomodar alguem. Chave ip+email, igual ao login.
 */
const recuperarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip ?? "");
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return `${ip}:${email}`;
  },
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
});

/** User-agent e IP so pra uma futura tela de "sessoes ativas" — nunca pra autenticar. */
function contextoDaRequisicao(req: { headers: Record<string, any>; ip?: string }): ContextoSessao {
  const ua = req.headers["user-agent"];
  return { userAgent: typeof ua === "string" ? ua : null, ip: req.ip ?? null };
}

const loginSchema = z.object({
  email: z.string().min(1).max(200),
  // Teto de tamanho: sem ele, um corpo enorme atravessa ate o bcrypt a cada
  // tentativa. bcrypt trunca em 72 bytes, entao nada acima disso e util.
  senha: z.string().min(1).max(200),
});

function toPublic(u: {
  id: string;
  nome: string;
  email: string;
  role: string;
  provedorId: string | null;
  ativo: boolean;
  temFoto: boolean;
  fotoVersao: number;
  status: string | null;
  statusTexto: string | null;
  nomeExibicao: string | null;
  bio: string | null;
  telefoneContato: string | null;
  assinaturaChat: string | null;
  corDestaque: string | null;
  provedoresPermitidos: string[];
  permissoes: unknown;
}): UsuarioPublic {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role as UsuarioPublic["role"],
    provedorId: u.provedorId,
    ativo: u.ativo,
    temFoto: u.temFoto,
    fotoVersao: u.fotoVersao,
    status: u.status as StatusPreset | null,
    statusTexto: u.statusTexto,
    nomeExibicao: u.nomeExibicao,
    bio: u.bio,
    telefoneContato: u.telefoneContato,
    assinaturaChat: u.assinaturaChat,
    corDestaque: u.corDestaque,
    // Os limites do supervisor: o painel monta o menu e a tela inicial com eles.
    // Normalizado como no requireAuth, pra tela e API lerem a MESMA regra.
    provedoresPermitidos: u.provedoresPermitidos,
    permissoes: normalizarPermissoes(u.permissoes ?? null),
  };
}

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, senha } = loginSchema.parse(req.body);
    const ident = email.toLowerCase().trim();

    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email: ident },
          { email: `${ident}@netgo.psi.br` },
          { email: `${ident}@netgo.net.br` },
          { email: { startsWith: `${ident}@`, mode: "insensitive" } },
        ],
      },
    });
    if (!usuario || !usuario.ativo) {
      throw new HttpError(401, "Credenciais invalidas");
    }

    const senhaOk = await verifyPassword(senha, usuario.senhaHash);
    if (!senhaOk) {
      throw new HttpError(401, "Credenciais invalidas");
    }

    const token = signToken({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role as UsuarioPublic["role"],
      provedorId: usuario.provedorId,
      tv: usuario.tokenVersion,
    });

    /*
     * `refreshToken` e ADITIVO: o app mobile ignora um campo JSON que nao
     * conhece e continua com a sessao de 8h + biometria dele, sem alteracao.
     * Por isso o access token nao encurtou — encurtar quebraria o mobile, que
     * nao sabe renovar.
     */
    const refreshToken = await emitirRefresh(usuario.id, contextoDaRequisicao(req));

    res.json({ token, refreshToken, usuario: toPublic(usuario) });
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1).max(500) });

/**
 * Renova a sessao sem pedir senha. Publica de proposito: quem chega aqui esta
 * justamente com o access token vencido, entao exigir `requireAuth` tornaria a
 * rota inalcancavel exatamente quando ela e necessaria.
 *
 * `refreshLimiter` cobre o unico abuso possivel — chutar tokens no escuro.
 */
authRouter.post(
  "/refresh",
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const resultado = await rotacionarRefresh(refreshToken, contextoDaRequisicao(req));

    if (resultado.tipo === "reuso") {
      /*
       * Um refresh ja queimado voltou fora da janela de graca. Isso nao
       * acontece num cliente honesto: ou o token vazou, ou foi clonado. Derruba
       * TUDO do usuario — as sessoes longas e os access tokens ja emitidos.
       * Custa um novo login a quem for legitimo; o contrario custaria a conta.
       */
      await revogarTudoDoUsuario(resultado.usuarioId);
      console.warn(`[auth] refresh reutilizado — todas as sessoes do usuario ${resultado.usuarioId} foram revogadas`);
      throw new HttpError(401, "Sessao encerrada. Entre novamente.");
    }
    if (resultado.tipo === "invalido") throw new HttpError(401, "Sessao expirada. Entre novamente.");

    const usuario = await prisma.usuario.findUnique({ where: { id: resultado.usuarioId } });
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Sessao encerrada. Entre novamente.");

    const token = signToken({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role as UsuarioPublic["role"],
      provedorId: usuario.provedorId,
      tv: usuario.tokenVersion,
    });

    res.json({ token, refreshToken: resultado.refreshToken, usuario: toPublic(usuario) });
  }),
);

/**
 * Logout de VERDADE: encerra a sessao longa no servidor. Ate aqui o logout era
 * so client-side (descartar o token), e o refresh continuaria valendo.
 *
 * Sem `requireAuth` de proposito: deslogar tem que funcionar mesmo com o access
 * token ja vencido, que e justamente quando a pessoa costuma sair.
 */
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await revogarRefresh(refreshToken);
    res.status(204).end();
  }),
);

/** Uma sessao de painel por abertura do app ja basta; mais que isso por minuto e loop. */
const sessaoWebLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub ?? ipKeyGenerator(req.ip ?? ""),
  message: { error: "Muitas aberturas do painel em pouco tempo. Aguarde um instante." },
});

/**
 * `POST /auth/sessao-web` — o app abre o painel web dentro dele (WebView) ja
 * logado, com uma sessao PROPRIA.
 *
 * Por que nao reaproveitar o refresh do app: ele e rotativo, e um refresh ja
 * queimado que volta fora da janela de graca e tratado como roubo (revoga TUDO
 * do usuario). App e painel renovando o mesmo token derrubariam um ao outro.
 * Com uma sessao separada cada lado rotaciona a sua; "sair de todos" continua
 * derrubando as duas, como deve.
 */
authRouter.post(
  "/sessao-web",
  requireAuth,
  sessaoWebLimiter,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Sessao encerrada. Entre novamente.");
    const token = signToken({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role as UsuarioPublic["role"],
      provedorId: usuario.provedorId,
      tv: usuario.tokenVersion,
    });
    const refreshToken = await emitirRefresh(usuario.id, contextoDaRequisicao(req));
    res.json({ token, refreshToken, usuario: toPublic(usuario) });
  }),
);

const recuperarSchema = z.object({ email: z.string().email() });
const redefinirSchema = z.object({
  token: z.string().min(1).max(500),
  novaSenha: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres"),
});

/**
 * Pede o link de redefinicao.
 *
 * Responde 200 SEMPRE — e-mail cadastrado ou nao, SMTP no ar ou fora. Qualquer
 * diferenca de resposta transformaria esta tela num oraculo de quem tem conta
 * no sistema, que e exatamente o que um atacante quer antes de tentar senhas.
 */
authRouter.post(
  "/recuperar-senha",
  recuperarLimiter,
  asyncHandler(async (req, res) => {
    const { email } = recuperarSchema.parse(req.body);
    await solicitarRecuperacao(email);
    res.json({
      mensagem: "Se houver uma conta com esse e-mail, o link de redefinicao ja esta a caminho.",
    });
  }),
);

/** Consome o link e troca a senha. Publica: quem chega aqui nao tem sessao. */
authRouter.post(
  "/redefinir-senha",
  recuperarLimiter,
  asyncHandler(async (req, res) => {
    const { token, novaSenha } = redefinirSchema.parse(req.body);
    const resultado = await redefinirSenha(token, novaSenha);

    // Mensagem unica pros tres casos (inexistente, expirado, ja usado): dizer
    // qual deles foi so ajudaria quem esta testando links no escuro.
    if (resultado.tipo === "invalido") {
      // "Solicite" em vez de "Peca": as mensagens desta API sao todas sem
      // acento (53 delas), e sem cedilha "peca" vira outra palavra.
      throw new HttpError(400, "Este link expirou ou ja foi usado. Solicite um novo.");
    }
    res.status(204).end();
  }),
);

/** "Sair de todos os dispositivos": mata sessoes longas E access tokens vivos. */
authRouter.post(
  "/sair-de-todos",
  requireAuth,
  asyncHandler(async (req, res) => {
    await revogarTudoDoUsuario(req.user!.sub);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    // Revalida ativo a cada chamada — sem isso, desativar um usuario nao
    // derruba a sessao dele ate o token expirar (ate 8h por padrao).
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Usuario nao encontrado ou inativo");
    res.json(toPublic(usuario));
  }),
);

const senhaSchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres"),
});

authRouter.post(
  "/senha",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { senhaAtual, novaSenha } = senhaSchema.parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Usuario nao encontrado ou inativo");

    const ok = await verifyPassword(senhaAtual, usuario.senhaHash);
    /*
     * 400, NAO 401 — e falha de validacao de um campo do formulario, nao de
     * autenticacao: quem chega aqui ja passou pelo requireAuth e ESTA logado.
     *
     * Nao e purismo de status code. O cliente vai passar a deslogar em 401
     * (renovacao de sessao), e com 401 aqui errar a senha atual expulsaria a
     * pessoa do sistema em vez de dizer "senha atual incorreta".
     */
    if (!ok) throw new HttpError(400, "Senha atual incorreta");

    const senhaHash = await hashPassword(novaSenha);
    // Trocar a senha DERRUBA as outras sessoes (tokenVersion++). Se a troca foi
    // por suspeita de vazamento, deixar o token antigo valendo mais 8h anularia
    // o proposito. O proprio usuario recebe um token novo abaixo, entao ele nao
    // e deslogado do aparelho onde acabou de trocar.
    const atualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash, tokenVersion: { increment: 1 } },
    });
    invalidarCacheSessao(usuario.id);

    const token = signToken({
      sub: atualizado.id,
      email: atualizado.email,
      role: atualizado.role as UsuarioPublic["role"],
      provedorId: atualizado.provedorId,
      tv: atualizado.tokenVersion,
    });
    res.json({ token });
  }),
);

const fotoSchema = z.object({
  fotoBase64: z.string().min(1),
  fotoMime: z.string().min(1),
});

/** Troca de foto e barata (bytes pequenos), mas ainda assim limitada — protecao
 * contra um retry-loop client bugado martelando escritas no banco. */
const fotoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub ?? ipKeyGenerator(req.ip ?? ""),
});

authRouter.patch(
  "/foto",
  requireAuth,
  fotoLimiter,
  asyncHandler(async (req, res) => {
    const { fotoBase64, fotoMime } = fotoSchema.parse(req.body);
    const dados = validarFotoPerfil(fotoBase64, fotoMime);
    const atualizado = await prisma.usuario.update({
      where: { id: req.user!.sub },
      data: { fotoDados: new Uint8Array(dados), fotoMime, temFoto: true, fotoVersao: { increment: 1 } },
    });
    res.json(toPublic(atualizado));
  }),
);

authRouter.delete(
  "/foto",
  requireAuth,
  asyncHandler(async (req, res) => {
    const atualizado = await prisma.usuario.update({
      where: { id: req.user!.sub },
      data: { fotoDados: null, fotoMime: null, temFoto: false, fotoVersao: { increment: 1 } },
    });
    res.json(toPublic(atualizado));
  }),
);

const statusSchema = z.object({
  status: z.nativeEnum(StatusPreset).nullable(),
  statusTexto: z.string().trim().max(140).nullable().optional(),
});

authRouter.patch(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, statusTexto } = statusSchema.parse(req.body);
    const atualizado = await prisma.usuario.update({
      where: { id: req.user!.sub },
      data: { status, statusTexto: statusTexto ?? null },
    });
    res.json(toPublic(atualizado));
  }),
);

/**
 * Foto de QUALQUER usuario interno — diferente das rotas acima (self-only),
 * esta existe pra renderizar o avatar dos colegas no chat. PROVEDOR fica de
 * fora (mesma fronteira que ja vale pro chat: nunca participa/ve equipe interna).
 * Existence-check antes do resto, mesmo padrao de GET /chat/mensagens/:id/anexo.
 */
authRouter.get(
  "/foto/:usuarioId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role === UserRole.PROVEDOR) throw new HttpError(403, "Sem acesso");
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.params.usuarioId },
      select: { fotoDados: true, fotoMime: true },
    });
    if (!usuario?.fotoDados || !usuario.fotoMime) throw new HttpError(404, "Sem foto");
    // Cache longo e seguro aqui: o cliente muda a URL (?v=fotoVersao) sempre
    // que o conteudo muda, entao uma URL nunca aponta pra bytes diferentes.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Type", usuario.fotoMime);
    res.send(Buffer.from(usuario.fotoDados));
  }),
);

const perfilSchema = z.object({
  nomeExibicao: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(280).nullable().optional(),
  telefoneContato: z.string().trim().max(30).nullable().optional(),
  assinaturaChat: z.string().trim().max(140).nullable().optional(),
  corDestaque: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor deve ser um hex #rrggbb")
    .nullable()
    .optional(),
});

/**
 * Campos de "sobre mim" do perfil — rota dedicada, separada de /status (outra
 * preocupacao: disponibilidade manual) e de /foto (binario). Mesmo grao do
 * resto deste arquivo: endpoints estreitos em vez de um PATCH canivete-suico.
 */
authRouter.patch(
  "/perfil",
  requireAuth,
  asyncHandler(async (req, res) => {
    const dados = perfilSchema.parse(req.body);
    const atualizado = await prisma.usuario.update({
      where: { id: req.user!.sub },
      data: dados,
    });
    res.json(toPublic(atualizado));
  }),
);
