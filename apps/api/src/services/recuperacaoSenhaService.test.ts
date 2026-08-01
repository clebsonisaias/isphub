import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RECUPERACAO DE SENHA.
 *
 * As duas propriedades que estes testes existem pra travar:
 *
 *  - **Nao vazar quem tem conta.** `solicitar()` tem que se comportar igual pra
 *    e-mail cadastrado e nao cadastrado. Se um dia alguem "melhorar" a funcao
 *    devolvendo um booleano de sucesso, a tela vira um oraculo de usuarios.
 *  - **Link de uso unico.** Token reaproveitado, expirado ou de usuario
 *    desativado nao pode trocar senha nenhuma.
 */

const {
  usuarioFindUnique,
  usuarioUpdate,
  tokenFindUnique,
  tokenCreate,
  tokenUpdateMany,
  $transaction,
} = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  usuarioUpdate: vi.fn(),
  tokenFindUnique: vi.fn(),
  tokenCreate: vi.fn(),
  tokenUpdateMany: vi.fn(),
  $transaction: vi.fn(),
}));
const { enviarEmail, smtpConfigurado } = vi.hoisted(() => ({
  enviarEmail: vi.fn(),
  smtpConfigurado: vi.fn(),
}));
const { revogarTudoDoUsuario } = vi.hoisted(() => ({ revogarTudoDoUsuario: vi.fn() }));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    usuario: { findUnique: usuarioFindUnique, update: usuarioUpdate },
    tokenRecuperacaoSenha: {
      findUnique: tokenFindUnique,
      create: tokenCreate,
      updateMany: tokenUpdateMany,
    },
    $transaction,
  },
}));
vi.mock("./emailService.js", () => ({ enviarEmail, smtpConfigurado }));
vi.mock("./refreshService.js", () => ({ revogarTudoDoUsuario }));

const { redefinirSenha, solicitarRecuperacao } = await import("./recuperacaoSenhaService.js");

const USUARIO = { id: "u-1", nome: "Maria", email: "maria@provedor.com.br", ativo: true };

beforeEach(() => {
  vi.clearAllMocks();
  smtpConfigurado.mockReturnValue(true);
  enviarEmail.mockResolvedValue(true);
  tokenUpdateMany.mockResolvedValue({ count: 1 });
  tokenCreate.mockResolvedValue({});
  $transaction.mockImplementation(async (fn: any) =>
    fn({
      tokenRecuperacaoSenha: { updateMany: tokenUpdateMany },
      usuario: { update: usuarioUpdate },
    }),
  );
});

describe("solicitarRecuperacao", () => {
  it("e-mail cadastrado: cria token (so o hash) e manda o link", async () => {
    usuarioFindUnique.mockResolvedValueOnce(USUARIO);

    await solicitarRecuperacao(USUARIO.email);

    const gravado = tokenCreate.mock.calls[0][0].data;
    expect(gravado.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(gravado.expiraEm.getTime()).toBeGreaterThan(Date.now());
    expect(enviarEmail).toHaveBeenCalledTimes(1);

    // O link tem que carregar o token CRU — o hash so existe no banco.
    const { para, texto } = enviarEmail.mock.calls[0][0];
    expect(para).toBe(USUARIO.email);
    expect(texto).toContain("/redefinir-senha?token=");
    expect(texto).not.toContain(gravado.tokenHash);
  });

  it("e-mail inexistente: mesma resposta (void), sem token e sem e-mail", async () => {
    usuarioFindUnique.mockResolvedValueOnce(null);

    await expect(solicitarRecuperacao("nao-existe@x.com")).resolves.toBeUndefined();

    expect(tokenCreate).not.toHaveBeenCalled();
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("usuario desativado nao recebe link", async () => {
    usuarioFindUnique.mockResolvedValueOnce({ ...USUARIO, ativo: false });
    await solicitarRecuperacao(USUARIO.email);
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("normaliza o e-mail antes de buscar (maiuscula/espaco nao impedem recuperar)", async () => {
    usuarioFindUnique.mockResolvedValueOnce(USUARIO);
    await solicitarRecuperacao("  Maria@Provedor.com.BR  ");
    expect(usuarioFindUnique.mock.calls[0][0].where.email).toBe("maria@provedor.com.br");
  });

  it("invalida pedidos pendentes anteriores — um link vivo por vez", async () => {
    usuarioFindUnique.mockResolvedValueOnce(USUARIO);
    await solicitarRecuperacao(USUARIO.email);

    // Sem isto, cada clique em "esqueci minha senha" deixaria mais uma chave
    // da mesma porta viva por 1h na caixa de entrada.
    expect(tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: USUARIO.id, usadoEm: null } }),
    );
  });

  it("SMTP fora do ar nao propaga erro — a resposta tem que continuar uniforme", async () => {
    usuarioFindUnique.mockResolvedValueOnce(USUARIO);
    enviarEmail.mockResolvedValueOnce(false);
    await expect(solicitarRecuperacao(USUARIO.email)).resolves.toBeUndefined();
  });
});

describe("redefinirSenha", () => {
  const tokenValido = () => ({
    id: "t-1",
    usadoEm: null,
    expiraEm: new Date(Date.now() + 30 * 60 * 1000),
    usuario: { id: USUARIO.id, ativo: true },
  });

  it("token valido troca a senha e derruba todas as sessoes", async () => {
    tokenFindUnique.mockResolvedValueOnce(tokenValido());

    expect(await redefinirSenha("cru", "senha-nova-123")).toEqual({ tipo: "ok" });

    // Grava HASH, nunca a senha em claro.
    const senhaHash = usuarioUpdate.mock.calls[0][0].data.senhaHash;
    expect(senhaHash).not.toBe("senha-nova-123");
    expect(senhaHash.startsWith("$2")).toBe(true);

    /*
     * Quem redefine ou esqueceu a senha, ou desconfia que alguem a tem. Deixar
     * sessao antiga viva anularia o proposito da troca.
     */
    expect(revogarTudoDoUsuario).toHaveBeenCalledWith(USUARIO.id);
  });

  it("token ja usado e recusado (uso unico)", async () => {
    tokenFindUnique.mockResolvedValueOnce({ ...tokenValido(), usadoEm: new Date() });

    expect(await redefinirSenha("cru", "senha-nova-123")).toEqual({ tipo: "invalido" });
    expect(usuarioUpdate).not.toHaveBeenCalled();
    expect(revogarTudoDoUsuario).not.toHaveBeenCalled();
  });

  it("token expirado e recusado", async () => {
    tokenFindUnique.mockResolvedValueOnce({ ...tokenValido(), expiraEm: new Date(Date.now() - 1000) });
    expect(await redefinirSenha("cru", "senha-nova-123")).toEqual({ tipo: "invalido" });
    expect(usuarioUpdate).not.toHaveBeenCalled();
  });

  it("token inexistente e recusado", async () => {
    tokenFindUnique.mockResolvedValueOnce(null);
    expect(await redefinirSenha("inventado", "senha-nova-123")).toEqual({ tipo: "invalido" });
  });

  it("usuario desativado nao consegue redefinir", async () => {
    tokenFindUnique.mockResolvedValueOnce({ ...tokenValido(), usuario: { id: USUARIO.id, ativo: false } });
    expect(await redefinirSenha("cru", "senha-nova-123")).toEqual({ tipo: "invalido" });
    expect(usuarioUpdate).not.toHaveBeenCalled();
  });

  it("dois cliques simultaneos no mesmo link: so o primeiro troca a senha", async () => {
    // A verificacao de `usadoEm` acima nao basta sozinha — duas requisicoes
    // paralelas passariam as duas por ela. Quem decide e a guarda dentro da
    // transacao (`updateMany ... usadoEm: null`), que so acha a linha uma vez.
    tokenFindUnique.mockResolvedValue(tokenValido());
    tokenUpdateMany.mockResolvedValueOnce({ count: 0 });

    expect(await redefinirSenha("cru", "senha-nova-123")).toEqual({ tipo: "invalido" });
    expect(usuarioUpdate).not.toHaveBeenCalled();
    expect(revogarTudoDoUsuario).not.toHaveBeenCalled();
  });
});
