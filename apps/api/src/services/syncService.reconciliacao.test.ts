import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsStatus } from "@isphub/shared";

/**
 * RECONCILIACAO DE OS QUE SAIU DA FILA DE ABERTAS.
 *
 * Causa raiz do bug "fechei no SGP e continua aberta aqui": a OS sumia das
 * varreduras de aberta, `osExisteNoSgp` respondia "sim, existe" (existe, so
 * nao esta mais aberta) e o codigo fazia `continue`. Nada acontecia, em todo
 * ciclo, pra sempre. Estes testes isolam esse bloco especifico do
 * `syncProvedor` — sem exercitar upsert/tipo/categoria/geo-backfill, que ja
 * tem cobertura propria — mantendo as tres varreduras de aberta VAZIAS
 * (`itens: []`) pra so a reconciliacao entrar em jogo.
 *
 * Se um teste daqui cair, ou uma OS fechada no SGP volta a ficar presa como
 * aberta pra sempre, ou uma instabilidade do SGP passa a cancelar OS em massa.
 */

const {
  erpConfigFindFirst,
  tipoOsFindMany,
  categoriaFindMany,
  ordemServicoFindMany,
  ordemServicoCount,
  ordemServicoGroupBy,
  ordemServicoUpdate,
  osEventoCreate,
  $transaction,
  syncLogCreate,
  erpConfigUpdate,
  comTravaExclusiva,
} = vi.hoisted(() => ({
  erpConfigFindFirst: vi.fn(),
  tipoOsFindMany: vi.fn(),
  categoriaFindMany: vi.fn(),
  ordemServicoFindMany: vi.fn(),
  ordemServicoCount: vi.fn(),
  ordemServicoGroupBy: vi.fn(),
  ordemServicoUpdate: vi.fn(),
  osEventoCreate: vi.fn(),
  $transaction: vi.fn(),
  syncLogCreate: vi.fn(),
  erpConfigUpdate: vi.fn(),
  comTravaExclusiva: vi.fn(),
}));
const { buildConnector } = vi.hoisted(() => ({ buildConnector: vi.fn() }));
const { emitParaTodos, emitParaUsuario } = vi.hoisted(() => ({ emitParaTodos: vi.fn(), emitParaUsuario: vi.fn() }));
const { desvincularPendentes } = vi.hoisted(() => ({ desvincularPendentes: vi.fn() }));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    erpConfig: { findFirst: erpConfigFindFirst, update: erpConfigUpdate },
    tipoOs: { findMany: tipoOsFindMany },
    categoria: { findMany: categoriaFindMany },
    // Duas queries distintas usam ordemServico.findMany (osConhecidas e o
    // backfill de geo) — diferenciadas pelo `select`, nao pela ordem de
    // chamada, pra nao quebrar se a ordem interna mudar.
    ordemServico: {
      findMany: ordemServicoFindMany,
      count: ordemServicoCount,
      groupBy: ordemServicoGroupBy,
      update: ordemServicoUpdate,
    },
    osEvento: { create: osEventoCreate },
    $transaction,
    syncLog: { create: syncLogCreate },
  },
  comTravaExclusiva,
}));
vi.mock("./erpConnectorService.js", () => ({ buildConnector }));
vi.mock("./realtimeHub.js", () => ({ emitParaTodos, emitParaUsuario }));
// O desvinculo de pendentes tem teste proprio (pendenteSemTecnico.test.ts);
// aqui so a ligacao dele no ciclo — e ele fora das contas de $transaction.
vi.mock("./writebackService.js", async (original) => ({
  ...(await original<typeof import("./writebackService.js")>()),
  desvincularPendentes,
}));

const { syncProvedor } = await import("./syncService.js");

const PROVEDOR_ID = "prov-1";
const CONFIG = { id: "cfg-1", provedorId: PROVEDOR_ID, tipo: "SGP", url: "https://sgp.exemplo.com.br", app: "app", tokenCifrado: "cif", ativo: true };

/** OS conhecida localmente como ABERTA — a candidata a "saiu da fila". */
function osAberta(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "os-1",
    sgpOsId: "6755",
    status: OsStatus.ABERTA,
    tecnicoId: "tec-1",
    statusAlteradoEm: null,
    observacaoAlteradaEm: null,
    ausenciasConsecutivas: 0,
    ...overrides,
  };
}

let listServiceOrders: ReturnType<typeof vi.fn>;
let obterStatusOs: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  erpConfigFindFirst.mockResolvedValue(CONFIG);
  tipoOsFindMany.mockResolvedValue([]);
  categoriaFindMany.mockResolvedValue([]);
  ordemServicoCount.mockResolvedValue(0);
  ordemServicoGroupBy.mockResolvedValue([]);
  ordemServicoUpdate.mockResolvedValue({ id: "os-1" });
  osEventoCreate.mockResolvedValue({ id: "ev-1" });
  syncLogCreate.mockResolvedValue({ id: "log-1" });
  erpConfigUpdate.mockResolvedValue(CONFIG);
  // $transaction recebe [update(...), osEvento.create(...)] como promises;
  // resolve executando cada uma (que ja sao os mocks acima).
  $transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  // Trava livre por padrao: roda o sync. O teste da trava ocupada sobrescreve.
  comTravaExclusiva.mockImplementation(async (_chave: string, fn: () => Promise<unknown>) => fn());

  // ordemServico.findMany: osConhecidas (select tem statusAlteradoEm) vs a
  // query do backfill de geo (select so tem contratoId) — distingue pelo shape.
  ordemServicoFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
    if (args?.select && "contratoId" in args.select && !("statusAlteradoEm" in args.select)) return [];
    return [osAberta()];
  });

  desvincularPendentes.mockResolvedValue(0);
  listServiceOrders = vi.fn().mockResolvedValue({ itens: [], total: 0, completo: true });
  obterStatusOs = vi.fn();
  buildConnector.mockReturnValue({ listServiceOrders, obterStatusOs, getContratoCadastro: vi.fn() });
});

it("as tres varreduras cobrem so os status ABERTOS — ENCERRADA nao e mais consultado", async () => {
  await syncProvedor(PROVEDOR_ID);
  expect(listServiceOrders).toHaveBeenCalledTimes(3);
  const statusConsultados = listServiceOrders.mock.calls.map(([params]) => params.status).sort();
  expect(statusConsultados).toEqual([0, 2, 3]); // ABERTA, EM_EXECUCAO, PENDENTE — sem ENCERRADA(1)
});

describe("OS pendente sai do despacho a cada ciclo", () => {
  it("o sync desvincula as pendentes do provedor", async () => {
    await syncProvedor(PROVEDOR_ID);
    expect(desvincularPendentes).toHaveBeenCalledWith(PROVEDOR_ID);
  });

  it("falha no desvinculo nao derruba o sync", async () => {
    desvincularPendentes.mockRejectedValue(new Error("banco fora"));
    obterStatusOs.mockResolvedValue({ tipo: "encontrada", statusBruto: 0 }); // ainda aberta: a reconciliacao nao mexe
    expect((await syncProvedor(PROVEDOR_ID)).ok).toBe(true);
  });
});

describe("varredura incompleta — nao ha evidencia confiavel", () => {
  it("varredura truncada NAO reconcilia nada, mesmo com candidata pendente", async () => {
    listServiceOrders
      .mockResolvedValueOnce({ itens: [], total: 999, completo: false }) // ABERTA truncou
      .mockResolvedValueOnce({ itens: [], total: 0, completo: true })
      .mockResolvedValueOnce({ itens: [], total: 0, completo: true });

    await syncProvedor(PROVEDOR_ID);

    expect(obterStatusOs).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("varredura completa — reconcilia OS que saiu da fila de abertas", () => {
  it("OS fechada no SGP (status encerrada) vira CONCLUIDA, nao fica presa como aberta", async () => {
    obterStatusOs.mockResolvedValue({ tipo: "encontrada", statusBruto: 1 }); // ENCERRADA

    await syncProvedor(PROVEDOR_ID);

    expect(obterStatusOs).toHaveBeenCalledWith("6755");
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(ordemServicoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "os-1" }, data: expect.objectContaining({ status: OsStatus.CONCLUIDA }) }),
    );
    expect(osEventoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ descricao: expect.stringContaining("Encerrada no SGP") }) }),
    );
  });

  /*
   * ESTE TESTE AFIRMAVA O BUG. Ele mockava `obterStatusOs` devolvendo `null` e
   * exigia CANCELADA — mas `null` tambem era o que o conector devolvia quando
   * nao reconhecia a resposta do SGP. Em producao (ago/2026) era SO isso que
   * acontecia, e o sync cancelou OS que o SGP estava listando no mesmo minuto.
   * Agora "nao existe" (404) e "nao entendi" sao respostas diferentes.
   */
  it("404 no SGP so cancela apos 3 ciclos seguidos — um sozinho apenas conta", async () => {
    obterStatusOs.mockResolvedValue({ tipo: "ausente" });

    await syncProvedor(PROVEDOR_ID);

    expect($transaction).not.toHaveBeenCalled();
    expect(ordemServicoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ausenciasConsecutivas: 1 } }),
    );
  });

  it("o 3o 404 seguido cancela de verdade", async () => {
    ordemServicoFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "contratoId" in args.select && !("statusAlteradoEm" in args.select)) return [];
      return [osAberta({ ausenciasConsecutivas: 2 })];
    });
    obterStatusOs.mockResolvedValue({ tipo: "ausente" });

    await syncProvedor(PROVEDOR_ID);

    expect(ordemServicoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OsStatus.CANCELADA }) }),
    );
    expect(osEventoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ descricao: expect.stringContaining("Removida no SGP") }) }),
    );
  });

  it("resposta que o conector nao entendeu NUNCA cancela, nem com o contador no limite", async () => {
    // A regressao de producao, no nivel do sync: mesmo com 2 ausencias ja
    // acumuladas, "indeterminado" nao pode empurrar a OS pro cancelamento.
    ordemServicoFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "contratoId" in args.select && !("statusAlteradoEm" in args.select)) return [];
      return [osAberta({ ausenciasConsecutivas: 2 })];
    });
    obterStatusOs.mockResolvedValue({ tipo: "indeterminado", motivo: "envelope nao reconhecido" });

    await syncProvedor(PROVEDOR_ID);

    expect($transaction).not.toHaveBeenCalled();
    expect(ordemServicoUpdate).not.toHaveBeenCalled();
  });

  it("obterStatusOs contradiz a varredura (ainda aberta no SGP) — nao mexe, so loga", async () => {
    obterStatusOs.mockResolvedValue({ tipo: "encontrada", statusBruto: 0 }); // ABERTA — contradiz a varredura

    await syncProvedor(PROVEDOR_ID);

    expect($transaction).not.toHaveBeenCalled();
    // Zera o contador: o SGP acabou de dizer que ela esta viva.
    expect(ordemServicoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ausenciasConsecutivas: 0 } }),
    );
  });

  it("erro de transporte em obterStatusOs — sem evidencia, NAO mexe (nunca cancela por instabilidade)", async () => {
    // Conector que LANCA: a interface nao proibe, e uma excecao aqui nao pode
    // derrubar o ciclo inteiro do provedor.
    obterStatusOs.mockRejectedValue(new Error("timeout"));

    const resultado = await syncProvedor(PROVEDOR_ID);

    expect(resultado.ok).toBe(true); // erro isolado nao derruba o ciclo inteiro
    expect($transaction).not.toHaveBeenCalled();
    expect(ordemServicoUpdate).not.toHaveBeenCalled();
  });

  it("OS ja Cancelada localmente + SGP diz Encerrada — reconciliarStatus mantem Cancelada (SGP nao distingue)", async () => {
    ordemServicoFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "contratoId" in args.select && !("statusAlteradoEm" in args.select)) return [];
      // OS_STATUS_ABERTOS nao inclui Cancelada, entao esta OS nem entraria
      // como candidata — mas serve de guarda: se algum dia OS_STATUS_ABERTOS
      // mudar pra incluir Cancelada, o teste flagra a regressao aqui.
      return [osAberta({ status: OsStatus.CANCELADA })];
    });
    obterStatusOs.mockResolvedValue({ tipo: "encontrada", statusBruto: 1 });

    await syncProvedor(PROVEDOR_ID);

    // Cancelada nao esta em OS_STATUS_ABERTOS, entao nunca vira candidata —
    // nenhuma reconciliacao roda pra ela.
    expect(obterStatusOs).not.toHaveBeenCalled();
  });

  it("avisa em tempo real (SSE) quando reconcilia uma OS", async () => {
    obterStatusOs.mockResolvedValue({ tipo: "encontrada", statusBruto: 1 });

    await syncProvedor(PROVEDOR_ID);

    expect(emitParaUsuario).toHaveBeenCalledWith("tec-1", expect.objectContaining({ tipo: "os-alterada" }));
    expect(emitParaTodos).toHaveBeenCalledWith(expect.objectContaining({ tipo: "os-alterada" }));
  });
});

describe("advisory lock por provedor", () => {
  it("trava ocupada: nao toca o SGP nem o banco e responde 'em andamento'", async () => {
    comTravaExclusiva.mockResolvedValueOnce(null);

    const resultado = await syncProvedor(PROVEDOR_ID);

    expect(resultado.ok).toBe(false);
    expect(resultado.message).toMatch(/em andamento/);
    expect(comTravaExclusiva).toHaveBeenCalledWith(`sync:${PROVEDOR_ID}`, expect.any(Function));
    expect(buildConnector).not.toHaveBeenCalled();
    expect(erpConfigUpdate).not.toHaveBeenCalled();
  });
});
