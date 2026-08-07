import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsStatus, UserRole } from "@isphub/shared";

/**
 * AVISO DE OS NOVA — o que este job NAO pode fazer.
 *
 * O risco aqui nao e deixar de avisar, e avisar demais: a coluna-trava nasce
 * nula, e sem cuidado o primeiro tick leria "nunca avisada" pras MIL OS que ja
 * existem e despejaria tudo isso no sino de cada admin. Os testes abaixo
 * travam as tres defesas: a trava por OS, a janela de idade e o teto por tick.
 */

const { ordemServicoFindMany, ordemServicoUpdate, usuarioFindMany, notificacaoCreateMany, $transaction } =
  vi.hoisted(() => ({
    ordemServicoFindMany: vi.fn(),
    ordemServicoUpdate: vi.fn(),
    usuarioFindMany: vi.fn(),
    notificacaoCreateMany: vi.fn(),
    $transaction: vi.fn(),
  }));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    ordemServico: { findMany: ordemServicoFindMany, update: ordemServicoUpdate },
    usuario: { findMany: usuarioFindMany },
    notificacao: { createMany: notificacaoCreateMany },
    $transaction,
  },
}));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

const { __tickParaTeste } = await import("./osNovaAlertScheduler.js");

function osNova(over: Record<string, unknown> = {}) {
  return {
    id: "os-1",
    sgpOsId: "96827",
    clienteNome: "JOAO GOMES NETO",
    tipoOs: { descricao: "Reparo" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ordemServicoUpdate.mockResolvedValue({});
  notificacaoCreateMany.mockResolvedValue({ count: 2 });
  $transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  usuarioFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "gestor-1" }]);
  ordemServicoFindMany.mockResolvedValue([osNova()]);
});

describe("o recorte da consulta", () => {
  it("so pega OS AINDA NAO avisada, e so as do Painel", async () => {
    await __tickParaTeste();

    const where = ordemServicoFindMany.mock.calls[0][0].where;
    // A trava: sem isto o mesmo aviso sairia a cada minuto, pra sempre.
    expect(where.novaNotificadaEm).toBeNull();
    // Retirada e a maioria esmagadora e e de outra equipe — notificar tudo
    // enterraria instalacao e reparo no meio do ruido.
    expect(where.AND).toBeDefined();
    expect(where.status.in).toEqual(expect.arrayContaining([OsStatus.ABERTA]));
  });

  it("ignora OS antiga — segunda defesa, independente da coluna", async () => {
    await __tickParaTeste();

    const where = ordemServicoFindMany.mock.calls[0][0].where;
    const corte = where.criadoEm.gte as Date;
    const horas = (Date.now() - corte.getTime()) / 3_600_000;
    // ~24h. Se o backfill da migracao falhar, o estrago para aqui em vez de
    // virar mil notificacoes de OS de meses atras.
    expect(horas).toBeGreaterThan(23);
    expect(horas).toBeLessThan(25);
  });

  it("tem teto por tick e drena da mais antiga", async () => {
    await __tickParaTeste();

    const args = ordemServicoFindMany.mock.calls[0][0];
    expect(args.take).toBeGreaterThan(0);
    expect(args.take).toBeLessThanOrEqual(50);
    // asc: com teto, a sobra nao pode ser sempre a mesma.
    expect(args.orderBy).toEqual({ criadoEm: "asc" });
  });
});

describe("o que grava", () => {
  it("avisa todo admin/gestor ativo, e so eles", async () => {
    await __tickParaTeste();

    expect(usuarioFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
      }),
    );
    const dados = notificacaoCreateMany.mock.calls[0][0].data;
    expect(dados).toHaveLength(2);
    expect(dados[0]).toMatchObject({ tipo: "os_nova", ordemServicoId: "os-1" });
    expect(dados[0].mensagem).toBe("Nova OS (Reparo): JOAO GOMES NETO");
  });

  it("trava e notificacao vao na MESMA transacao", async () => {
    // Gravar uma sem a outra: ou repete o aviso pra sempre, ou perde pra sempre.
    await __tickParaTeste();

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(ordemServicoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { novaNotificadaEm: expect.any(Date) } }),
    );
  });

  it("sem gestor ativo, nao grava nada — nem a trava", async () => {
    // Travar sem ninguem ter sido avisado engoliria a OS em silencio: quando
    // um gestor fosse criado, aquelas OS nunca mais apareceriam no sino.
    usuarioFindMany.mockResolvedValue([]);

    await __tickParaTeste();

    expect($transaction).not.toHaveBeenCalled();
    expect(ordemServicoUpdate).not.toHaveBeenCalled();
  });

  it("nenhuma OS nova => nao consulta usuario nem grava", async () => {
    ordemServicoFindMany.mockResolvedValue([]);

    await __tickParaTeste();

    expect(usuarioFindMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("falha no banco nao derruba o job", async () => {
    ordemServicoFindMany.mockRejectedValue(new Error("db fora"));

    await expect(__tickParaTeste()).resolves.toBeUndefined();
  });
});
