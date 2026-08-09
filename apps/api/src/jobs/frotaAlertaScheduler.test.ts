import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O SINO DA FROTA — o que ele nao pode fazer.
 *
 * Todo teste aqui existe por um defeito concreto que a revisao encontrou antes
 * de o codigo ir pro ar. Um sino que toca demais e ignorado, e um sino ignorado
 * e igual a nao ter alerta nenhum.
 */

const { eventoFindMany, eventoUpdateMany, notificacaoCreateMany, usuarioFindMany, transacao, detectar } = vi.hoisted(
  () => ({
    eventoFindMany: vi.fn(),
    eventoUpdateMany: vi.fn(),
    notificacaoCreateMany: vi.fn(),
    usuarioFindMany: vi.fn(),
    transacao: vi.fn(),
    detectar: vi.fn(),
  }),
);

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    eventoRastreador: { findMany: eventoFindMany, updateMany: eventoUpdateMany },
    notificacao: { createMany: notificacaoCreateMany },
    usuario: { findMany: usuarioFindMany },
    $transaction: transacao,
  },
}));

vi.mock("../services/frotaEventoService.js", () => ({ detectarEventosPorDuracao: detectar }));

const { __tickParaTeste: tick } = await import("./frotaAlertaScheduler.js");

const AGORA = Date.now();
const H = 60 * 60_000;

function evento(over: Record<string, unknown> = {}) {
  return {
    id: "e-1",
    tipo: "bateria_baixa",
    detalhe: { pct: 12 },
    veiculo: { placa: "HFX3652" },
    rastreador: { comunicando: true, ultimaPosicaoEm: new Date(AGORA - 60_000) },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  detectar.mockResolvedValue(0);
  usuarioFindMany.mockResolvedValue([{ id: "u-1" }, { id: "u-2" }]);
  eventoUpdateMany.mockResolvedValue({ count: 1 });
  notificacaoCreateMany.mockResolvedValue({ count: 2 });
  // O `$transaction` interativo: roda o callback com um `tx` que e o proprio
  // conjunto de mocks.
  transacao.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
    fn({
      eventoRastreador: { updateMany: eventoUpdateMany },
      notificacao: { createMany: notificacaoCreateMany },
    }),
  );
});

describe("frotaAlertaScheduler", () => {
  it("notifica todo gestor, com a placa no texto", async () => {
    eventoFindMany.mockResolvedValue([evento()]);
    await tick();

    const dados = (notificacaoCreateMany.mock.calls[0]![0] as { data: Record<string, string>[] }).data;
    expect(dados).toHaveLength(2);
    // `Notificacao` nao tem `veiculoId` — a identificacao vai no texto.
    expect(dados[0]!.mensagem).toBe("Bateria fraca: HFX-3652 (12%)");
    expect(dados[0]!.tipo).toBe("frota_alerta");
  });

  it("a trava e COMPARE-AND-SWAP: quem perde a corrida nao notifica", async () => {
    /*
     * Duas replicas leem o mesmo evento pendente e as duas chegam aqui. Sem o
     * predicado `notificadoEm: null`, as duas gravariam e o gestor receberia o
     * mesmo aviso em dobro.
     */
    eventoFindMany.mockResolvedValue([evento()]);
    eventoUpdateMany.mockResolvedValue({ count: 0 });
    await tick();
    expect(notificacaoCreateMany).not.toHaveBeenCalled();
  });

  it("offline de UM MINUTO nao toca o sino", async () => {
    /*
     * `derivarEventos` grava `ficou_offline` em toda transicao UP->DOWN, e um
     * aparelho que pisca faz isso o dia inteiro. A regra das 6h mora aqui.
     */
    eventoFindMany.mockResolvedValue([
      evento({
        id: "e-off",
        tipo: "ficou_offline",
        detalhe: null,
        rastreador: { comunicando: true, ultimaPosicaoEm: new Date(AGORA - 60_000) },
      }),
    ]);
    await tick();

    expect(notificacaoCreateMany).not.toHaveBeenCalled();
    // Mas CARIMBA: senao seria reavaliado a cada tique, para sempre.
    expect(eventoUpdateMany).toHaveBeenCalledWith({
      where: { id: "e-off", notificadoEm: null },
      data: { notificadoEm: expect.any(Date) },
    });
  });

  it("offline de mais de 6h, com o aparelho ainda mudo, toca", async () => {
    eventoFindMany.mockResolvedValue([
      evento({
        id: "e-off",
        tipo: "ficou_offline",
        detalhe: null,
        rastreador: { comunicando: false, ultimaPosicaoEm: new Date(AGORA - 7 * H) },
      }),
    ]);
    await tick();
    const dados = (notificacaoCreateMany.mock.calls[0]![0] as { data: Record<string, string>[] }).data;
    expect(dados[0]!.mensagem).toContain("Rastreador sem comunicação");
  });

  it("sem destinatario NAO carimba — o aviso nao pode ser engolido", async () => {
    usuarioFindMany.mockResolvedValue([]);
    eventoFindMany.mockResolvedValue([evento()]);
    await tick();
    expect(eventoUpdateMany).not.toHaveBeenCalled();
  });

  it("a janela olha `criadoEm`, e nao `em`", async () => {
    /*
     * Os dois divergem de proposito: `em` e ancorado no relogio do APARELHO e
     * pode ser bem anterior. Filtrar por `em` descartaria para sempre os eventos
     * de um aparelho que ficou dias fora — justamente os que mais importam.
     */
    eventoFindMany.mockResolvedValue([]);
    await tick();
    const where = (eventoFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.criadoEm).toBeDefined();
    expect(where.em).toBeUndefined();
  });

  it("falha ao detectar por duracao NAO impede o dreno do que ja esta pendente", async () => {
    detectar.mockRejectedValue(new Error("db fora"));
    eventoFindMany.mockResolvedValue([evento()]);
    await tick();
    expect(notificacaoCreateMany).toHaveBeenCalledTimes(1);
  });

  it("respeita o teto por tique", async () => {
    eventoFindMany.mockResolvedValue([]);
    await tick();
    expect((eventoFindMany.mock.calls[0]![0] as { take: number }).take).toBe(30);
  });
});
