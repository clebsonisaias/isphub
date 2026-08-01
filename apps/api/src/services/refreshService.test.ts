import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SESSAO LONGA DO NAVEGADOR — refresh token rotativo.
 *
 * O que estes testes protegem, em ordem de gravidade se quebrarem:
 *
 *  1. Um refresh queimado voltando a valer = sessao que nao morre nunca.
 *  2. A deteccao de reuso deixando de disparar = token vazado continua util.
 *  3. A deteccao de reuso disparando DEMAIS = abrir duas abas desloga a pessoa
 *     de todos os aparelhos, que e pior na pratica do que o bug original.
 *
 * Nao havia NENHUM teste de autenticacao neste projeto antes destes.
 */

const {
  sessaoFindUnique,
  sessaoCreate,
  sessaoUpdateMany,
  usuarioUpdate,
  $transaction,
} = vi.hoisted(() => ({
  sessaoFindUnique: vi.fn(),
  sessaoCreate: vi.fn(),
  sessaoUpdateMany: vi.fn(),
  usuarioUpdate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    sessaoRefresh: {
      findUnique: sessaoFindUnique,
      create: sessaoCreate,
      updateMany: sessaoUpdateMany,
    },
    usuario: { update: usuarioUpdate },
    $transaction,
  },
}));

const { emitirRefresh, revogarRefresh, revogarTudoDoUsuario, rotacionarRefresh } = await import(
  "./refreshService.js"
);

const USUARIO = "u-1";

/** Sessao viva, com os campos que o servico consulta. */
function sessaoValida(over: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    usuarioId: USUARIO,
    expiraEm: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    revogadoEm: null,
    userAgent: "Firefox",
    ip: "10.0.0.1",
    usuario: { ativo: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessaoCreate.mockResolvedValue({ id: "s-nova" });
  sessaoUpdateMany.mockResolvedValue({ count: 1 });
  usuarioUpdate.mockResolvedValue({});
  // Executa o callback da transacao com o mesmo client mockado.
  $transaction.mockImplementation(async (fn: any) =>
    fn({
      sessaoRefresh: { create: sessaoCreate, updateMany: sessaoUpdateMany },
    }),
  );
});

describe("emitirRefresh", () => {
  it("nunca grava o token cru — so o hash", async () => {
    const token = await emitirRefresh(USUARIO);

    const gravado = sessaoCreate.mock.calls[0][0].data;
    expect(gravado.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(gravado.tokenHash).not.toBe(token);
    // Nenhum campo do insert pode conter o token em claro.
    expect(JSON.stringify(gravado)).not.toContain(token);
  });

  it("dois tokens seguidos sao diferentes (entropia, nao contador)", async () => {
    const a = await emitirRefresh(USUARIO);
    const b = await emitirRefresh(USUARIO);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
  });

  it("trunca userAgent e ip no tamanho da coluna", async () => {
    await emitirRefresh(USUARIO, { userAgent: "x".repeat(400), ip: "y".repeat(100) });
    const { userAgent, ip } = sessaoCreate.mock.calls[0][0].data;
    expect(userAgent).toHaveLength(300);
    expect(ip).toHaveLength(64);
  });
});

describe("rotacionarRefresh", () => {
  it("token valido rotaciona: queima o antigo e devolve um novo diferente", async () => {
    sessaoFindUnique.mockResolvedValueOnce(sessaoValida());

    const r = await rotacionarRefresh("token-cru");

    expect(r).toMatchObject({ tipo: "ok", usuarioId: USUARIO });
    // O antigo foi revogado com a guarda de concorrencia.
    expect(sessaoUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s-1", revogadoEm: null } }),
    );
    expect(sessaoUpdateMany.mock.calls[0][0].data.revogadoEm).toBeInstanceOf(Date);
    // E um novo foi criado.
    expect(sessaoCreate).toHaveBeenCalledTimes(1);
    if (r.tipo === "ok") expect(r.refreshToken).not.toBe("token-cru");
  });

  it("token desconhecido e recusado (nao cria sessao nenhuma)", async () => {
    sessaoFindUnique.mockResolvedValueOnce(null);
    expect(await rotacionarRefresh("nao-existe")).toEqual({ tipo: "invalido" });
    expect(sessaoCreate).not.toHaveBeenCalled();
  });

  it("token expirado e recusado — e o que faz a sessao morrer por inatividade", async () => {
    sessaoFindUnique.mockResolvedValueOnce(sessaoValida({ expiraEm: new Date(Date.now() - 1000) }));
    expect(await rotacionarRefresh("velho")).toEqual({ tipo: "invalido" });
    expect(sessaoCreate).not.toHaveBeenCalled();
  });

  it("usuario desativado nao renova, mesmo com refresh dentro da validade", async () => {
    sessaoFindUnique.mockResolvedValueOnce(sessaoValida({ usuario: { ativo: false } }));
    expect(await rotacionarRefresh("de-inativo")).toEqual({ tipo: "invalido" });
  });

  it("token queimado FORA da janela de graca => reuso (token vazado)", async () => {
    sessaoFindUnique.mockResolvedValueOnce(
      sessaoValida({ revogadoEm: new Date(Date.now() - 60_000) }),
    );

    expect(await rotacionarRefresh("queimado")).toEqual({ tipo: "reuso", usuarioId: USUARIO });
    // Reuso NAO emite sessao nova — quem decide o que fazer e a rota.
    expect(sessaoCreate).not.toHaveBeenCalled();
  });

  /*
   * O caso que fez a janela de graca existir. Duas abas renovam ao mesmo tempo:
   * a primeira queima o token, a segunda chega com ele ja revogado. Sem a
   * janela, isso seria classificado como vazamento e derrubaria TODAS as
   * sessoes do usuario — abrir duas abas deslogaria a pessoa do celular.
   */
  it("token queimado DENTRO da janela => emite sessao irma, nao acusa reuso", async () => {
    sessaoFindUnique.mockResolvedValueOnce(
      sessaoValida({ revogadoEm: new Date(Date.now() - 5_000) }),
    );

    const r = await rotacionarRefresh("outra-aba");

    expect(r.tipo).toBe("ok");
    expect(sessaoCreate).toHaveBeenCalledTimes(1);
    // Herda o contexto da sessao anterior quando a request nao traz o seu.
    expect(sessaoCreate.mock.calls[0][0].data.userAgent).toBe("Firefox");
  });

  it("estado impossivel na releitura recusa em vez de recorrer pra sempre", async () => {
    // Se a releitura insistir em mostrar o token como vivo (lag de replica),
    // a guarda corta. Recusar custa um login; recursao infinita custa o processo.
    sessaoFindUnique.mockResolvedValue(sessaoValida());
    sessaoUpdateMany.mockResolvedValue({ count: 0 });

    expect(await rotacionarRefresh("patologico")).toEqual({ tipo: "invalido" });
    expect(sessaoFindUnique).toHaveBeenCalledTimes(2);
  });

  it("perder a corrida da transacao vira a janela de graca, nao erro", async () => {
    // 1a leitura: token vivo. A transacao nao encontra a linha (a outra aba
    // revogou primeiro) => count 0. Na releitura, o token aparece queimado
    // agora mesmo, caindo na janela de graca.
    sessaoFindUnique
      .mockResolvedValueOnce(sessaoValida())
      .mockResolvedValueOnce(sessaoValida({ revogadoEm: new Date() }));
    sessaoUpdateMany.mockResolvedValueOnce({ count: 0 });

    const r = await rotacionarRefresh("disputado");

    expect(r.tipo).toBe("ok");
    expect(sessaoFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe("revogarRefresh", () => {
  it("revoga so a sessao daquele token e e idempotente", async () => {
    sessaoUpdateMany.mockResolvedValue({ count: 0 });
    await expect(revogarRefresh("qualquer")).resolves.toBeUndefined();

    const where = sessaoUpdateMany.mock.calls[0][0].where;
    expect(where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    // `revogadoEm: null` evita reescrever a data de quem ja saiu.
    expect(where.revogadoEm).toBeNull();
  });
});

describe("revogarTudoDoUsuario", () => {
  it("mata as sessoes longas E os access tokens ja emitidos", async () => {
    await revogarTudoDoUsuario(USUARIO);

    expect(sessaoUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: USUARIO, revogadoEm: null } }),
    );
    /*
     * O incremento de tokenVersion e o que derruba o JWT que ja esta na mao do
     * cliente. So revogar o refresh deixaria o access token valendo ate 8h —
     * "sair de todos os dispositivos" que nao tira ninguem de lugar nenhum.
     */
    expect(usuarioUpdate).toHaveBeenCalledWith({
      where: { id: USUARIO },
      data: { tokenVersion: { increment: 1 } },
    });
  });
});
