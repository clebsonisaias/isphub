import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusPreset } from "@isphub/shared";

/**
 * JORNADA — o que este service nao pode deixar acontecer.
 *
 * "Tempo trabalhado" e um numero que o tecnico confere todo dia. Ele so vale se
 * houver UMA jornada aberta por pessoa: duas, e o tempo passa a ser ficcao sem
 * ninguem perceber. Os testes abaixo travam a idempotencia (inclusive quando a
 * corrida acontece de verdade e o banco recusa) e o acoplamento com o status.
 */

const {
  jornadaFindFirst,
  jornadaCreate,
  jornadaUpdate,
  jornadaFindMany,
  usuarioUpdate,
  ocupacaoFindFirst,
  ocupacaoUpdate,
  $transaction,
} = vi.hoisted(() => ({
  jornadaFindFirst: vi.fn(),
  jornadaCreate: vi.fn(),
  jornadaUpdate: vi.fn(),
  jornadaFindMany: vi.fn(),
  usuarioUpdate: vi.fn(),
  ocupacaoFindFirst: vi.fn(),
  ocupacaoUpdate: vi.fn(),
  $transaction: vi.fn(),
}));

/*
 * `ocupacaoVeiculo` entra no duble porque encerrar a jornada agora fecha a
 * ocupacao junto — ninguem continua "dentro da viatura" depois de bater a
 * saida. Sem isto o teste falha em `findFirst` de undefined, que e ruido, nao
 * regressao.
 */
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    jornadaTecnico: {
      findFirst: jornadaFindFirst,
      create: jornadaCreate,
      update: jornadaUpdate,
      findMany: jornadaFindMany,
    },
    usuario: { update: usuarioUpdate },
    ocupacaoVeiculo: { findFirst: ocupacaoFindFirst, update: ocupacaoUpdate },
    $transaction,
  },
}));

const { iniciarJornada, encerrarJornada, jornadaAtual, jornadasAtivas } = await import("./jornadaService.js");

/** O duble do prisma, pra passar como `tx` na forma em callback. */
const { prisma: prismaDuble } = await import("../lib/prisma.js");

const USUARIO = "tec-1";
const INICIO = new Date("2026-08-07T10:00:00.000Z");

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "j-1",
    inicioEm: INICIO,
    fimEm: null,
    latInicio: null,
    lngInicio: null,
    latFim: null,
    lngFim: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  /*
   * O `$transaction` do Prisma tem DUAS formas: array (o iniciar usa) e
   * callback (o encerrar passou a usar, porque precisa de logica condicional).
   * O duble atende as duas — senao o teste falharia com "function is not
   * iterable", que nao diz nada sobre o comportamento.
   */
  $transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaDuble) : Promise.all(arg as Promise<unknown>[]),
  );
  // Sem ocupacao aberta e o caso padrao: o tecnico que foi a pe.
  ocupacaoFindFirst.mockResolvedValue(null);
  jornadaCreate.mockResolvedValue(linha());
  jornadaUpdate.mockResolvedValue(linha({ fimEm: new Date("2026-08-07T18:00:00.000Z") }));
  usuarioUpdate.mockResolvedValue({});
});

describe("iniciarJornada", () => {
  it("sem jornada aberta, cria uma e poe o tecnico como Disponivel", async () => {
    jornadaFindFirst.mockResolvedValue(null);

    const j = (await iniciarJornada(USUARIO)).jornada;

    expect(j.id).toBe("j-1");
    expect(j.inicioEm).toBe(INICIO.toISOString());
    expect(usuarioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: StatusPreset.DISPONIVEL } }),
    );
  });

  it("jornada e status vao na MESMA transacao", async () => {
    /*
     * Separados, dava pra gravar um e falhar o outro: jornada aberta com status
     * "Indisponivel" deixa o gestor sem saber em qual acreditar.
     */
    jornadaFindFirst.mockResolvedValue(null);

    await iniciarJornada(USUARIO);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("com jornada JA aberta, devolve a existente e nao cria outra", async () => {
    // O caso do toque duplo — comum com luva, e com rede lenta o botao demora
    // a responder, entao a pessoa toca de novo.
    jornadaFindFirst.mockResolvedValue(linha());

    const j = (await iniciarJornada(USUARIO)).jornada;

    expect(j.id).toBe("j-1");
    expect(jornadaCreate).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("se a CORRIDA acontecer e o banco recusar (P2002), devolve a que venceu", async () => {
    /*
     * Dois pedidos simultaneos passam os dois pelo `findFirst` e so um sobrevive
     * ao INSERT (indice parcial `jornadas_tecnico_uma_aberta_por_usuario`).
     * Perder a corrida NAO e erro: o tecnico queria estar em jornada, e esta.
     * Devolver 500 aqui faria a tela mostrar falha numa acao que deu certo.
     */
    jornadaFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(linha({ id: "j-vencedora" }));
    $transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));

    const j = (await iniciarJornada(USUARIO)).jornada;

    expect(j.id).toBe("j-vencedora");
  });

  it("erro que NAO e de unicidade continua estourando", async () => {
    // Engolir qualquer erro esconderia banco fora do ar como "tudo certo".
    jornadaFindFirst.mockResolvedValue(null);
    $transaction.mockRejectedValueOnce(new Error("conexao recusada"));

    await expect(iniciarJornada(USUARIO)).rejects.toThrow("conexao recusada");
  });

  it("guarda a coordenada quando ela vem, e aceita a ausencia", async () => {
    jornadaFindFirst.mockResolvedValue(null);

    await iniciarJornada(USUARIO, { lat: -5.79, lng: -35.2 });
    expect(jornadaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ latInicio: -5.79, lngInicio: -35.2 }) }),
    );

    vi.clearAllMocks();
    $transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    jornadaCreate.mockResolvedValue(linha());
    jornadaFindFirst.mockResolvedValue(null);
    // Permissao de localizacao negada nao pode impedir alguem de comecar o turno.
    await iniciarJornada(USUARIO);
    expect(jornadaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ latInicio: null, lngInicio: null }) }),
    );
  });
});

describe("encerrarJornada", () => {
  it("fecha a aberta e poe o tecnico como Indisponivel", async () => {
    jornadaFindFirst.mockResolvedValue({ id: "j-1" });

    const j = await encerrarJornada(USUARIO);

    expect(j.fimEm).toBe("2026-08-07T18:00:00.000Z");
    expect(usuarioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: StatusPreset.INDISPONIVEL } }),
    );
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("sem jornada aberta responde 409, nao 404 nem 500", async () => {
    /*
     * 409 porque o pedido esta certo e o recurso existe — o que nao bate e o
     * ESTADO. Na pratica quase sempre e o segundo toque no botao, entao a tela
     * mostra uma frase que a pessoa entende em vez de "erro interno".
     */
    jornadaFindFirst.mockResolvedValue(null);

    await expect(encerrarJornada(USUARIO)).rejects.toMatchObject({ status: 409 });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("jornadaAtual", () => {
  it("devolve null quando nao ha aberta", async () => {
    jornadaFindFirst.mockResolvedValue(null);
    expect(await jornadaAtual(USUARIO)).toBeNull();
  });

  it("filtra por fimEm nulo — jornada encerrada nao conta como atual", async () => {
    jornadaFindFirst.mockResolvedValue(linha());
    await jornadaAtual(USUARIO);
    expect(jornadaFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: USUARIO, fimEm: null } }),
    );
  });
});

describe("jornadasAtivas", () => {
  it("achata o usuario e serializa a data", async () => {
    jornadaFindMany.mockResolvedValue([
      {
        inicioEm: INICIO,
        usuario: { id: "tec-1", nome: "Carlos", nomeExibicao: null, temFoto: true, fotoVersao: 3 },
      },
    ]);

    const ativas = await jornadasAtivas();

    expect(ativas).toEqual([
      {
        usuarioId: "tec-1",
        nome: "Carlos",
        nomeExibicao: null,
        temFoto: true,
        fotoVersao: 3,
        inicioEm: INICIO.toISOString(),
      },
    ]);
  });

  it("so traz quem esta em servico agora", async () => {
    jornadaFindMany.mockResolvedValue([]);
    await jornadasAtivas();
    expect(jornadaFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fimEm: null } }));
  });
});
