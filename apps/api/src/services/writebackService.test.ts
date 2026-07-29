import { beforeEach, describe, expect, it, vi } from "vitest";
import { OsStatus } from "@isphub/shared";

/**
 * ISOLAMENTO MULTI-TENANT DA ESCRITA NO SGP.
 *
 * A ISPhub fala com o SGP de VARIOS provedores, cada um com URL, app e token
 * proprios. Toda escrita tem que sair na base do provedor DAQUELA OS — mandar a
 * OS do provedor X pro SGP do Y nao daria erro obvio: daria 403/404 do outro
 * lado (exatamente o sintoma que se investiga quando "marcar a caminho" falha),
 * ou pior, escreveria numa OS de numero igual na base errada.
 *
 * Se um teste daqui cair, a escrita vazou de tenant.
 */

const { findUnique, findFirst, update, $transaction, osEventoCreate } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  $transaction: vi.fn(),
  osEventoCreate: vi.fn(),
}));
const { buildConnector } = vi.hoisted(() => ({ buildConnector: vi.fn() }));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    ordemServico: { findUnique, update },
    erpConfig: { findFirst },
    osEvento: { create: osEventoCreate },
    $transaction,
  },
}));
vi.mock("./erpConnectorService.js", () => ({ buildConnector }));
vi.mock("./realtimeHub.js", () => ({ emitParaUsuario: vi.fn() }));
vi.mock("./pushService.js", () => ({ dispararPush: vi.fn() }));

const { marcarACaminho, adicionarAnotacao } = await import("./writebackService.js");

/** Duas bases distintas de verdade — URL, app e token diferentes. */
const CONFIG_X = { id: "cfg-x", provedorId: "prov-x", tipo: "SGP", url: "https://sgp-x.com.br", app: "app-x", tokenCifrado: "cif-x", ativo: true };
const CONFIG_Y = { id: "cfg-y", provedorId: "prov-y", tipo: "SGP", url: "https://sgp-y.com.br", app: "app-y", tokenCifrado: "cif-y", ativo: true };

function osDoProvedor(provedorId: string, sgpOsId: string) {
  return { id: `os-${provedorId}`, provedorId, sgpOsId, tecnicoId: "tec-1", status: OsStatus.ABERTA };
}

let conectorFalso: { setOnTheWay: ReturnType<typeof vi.fn>; addOsNote: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  conectorFalso = { setOnTheWay: vi.fn().mockResolvedValue(undefined), addOsNote: vi.fn().mockResolvedValue(undefined) };
  buildConnector.mockReturnValue(conectorFalso);
  // A transacao devolve [osAtualizada, evento]; so o 1o item e usado.
  $transaction.mockImplementation(async (ops: unknown[]) => ops.map(() => ({ id: "os-1", tecnicoId: "tec-1" })));
  update.mockResolvedValue({ id: "os-1" });
  osEventoCreate.mockResolvedValue({ id: "ev-1" });
});

describe("marcarACaminho — vai para o SGP do provedor DA OS", () => {
  it("OS do provedor X usa a config do X (nao a do Y)", async () => {
    findUnique.mockResolvedValue(osDoProvedor("prov-x", "5326"));
    findFirst.mockResolvedValue(CONFIG_X);

    await marcarACaminho("os-prov-x", "autor-1");

    // A busca da integracao foi ESCOPADA ao provedor da OS.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ provedorId: "prov-x" }) }),
    );
    // E o conector foi montado com as credenciais DESSE provedor.
    expect(buildConnector).toHaveBeenCalledWith(CONFIG_X);
    expect(buildConnector).not.toHaveBeenCalledWith(CONFIG_Y);
  });

  it("OS do provedor Y usa a config do Y", async () => {
    findUnique.mockResolvedValue(osDoProvedor("prov-y", "77"));
    findFirst.mockResolvedValue(CONFIG_Y);

    await marcarACaminho("os-prov-y", "autor-1");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ provedorId: "prov-y" }) }),
    );
    expect(buildConnector).toHaveBeenCalledWith(CONFIG_Y);
    expect(buildConnector).not.toHaveBeenCalledWith(CONFIG_X);
  });

  it("envia o sgpOsId (numero na base do provedor), nao o id interno da ISPhub", async () => {
    findUnique.mockResolvedValue(osDoProvedor("prov-x", "5326"));
    findFirst.mockResolvedValue(CONFIG_X);

    await marcarACaminho("os-prov-x", "autor-1");

    expect(conectorFalso.setOnTheWay).toHaveBeenCalledWith("5326");
    expect(conectorFalso.setOnTheWay).not.toHaveBeenCalledWith("os-prov-x");
  });

  it("dois provedores em sequencia nao contaminam um ao outro (sem cache/estado compartilhado)", async () => {
    findUnique.mockResolvedValueOnce(osDoProvedor("prov-x", "5326"));
    findFirst.mockResolvedValueOnce(CONFIG_X);
    await marcarACaminho("os-prov-x", "autor-1");

    findUnique.mockResolvedValueOnce(osDoProvedor("prov-y", "77"));
    findFirst.mockResolvedValueOnce(CONFIG_Y);
    await marcarACaminho("os-prov-y", "autor-1");

    expect(buildConnector).toHaveBeenNthCalledWith(1, CONFIG_X);
    expect(buildConnector).toHaveBeenNthCalledWith(2, CONFIG_Y);
  });

  it("so integracao ATIVA conta — config desligada nao escreve em lugar nenhum", async () => {
    findUnique.mockResolvedValue(osDoProvedor("prov-x", "5326"));
    findFirst.mockResolvedValue(null); // o where exige ativo: true

    await expect(marcarACaminho("os-prov-x", "autor-1")).rejects.toMatchObject({ status: 409 });
    expect(buildConnector).not.toHaveBeenCalled();
    expect(conectorFalso.setOnTheWay).not.toHaveBeenCalled();
  });

  it("a busca da integracao sempre exige ativo:true e tipo SGP", async () => {
    findUnique.mockResolvedValue(osDoProvedor("prov-x", "5326"));
    findFirst.mockResolvedValue(CONFIG_X);

    await marcarACaminho("os-prov-x", "autor-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: { provedorId: "prov-x", tipo: "SGP", ativo: true },
    });
  });
});

describe("anotacao — mesmo isolamento", () => {
  it("anotacao da OS do provedor Y sai na base do Y", async () => {
    findUnique.mockResolvedValue(osDoProvedor("prov-y", "77"));
    findFirst.mockResolvedValue(CONFIG_Y);

    await adicionarAnotacao("os-prov-y", "instalado", "autor-1");

    expect(buildConnector).toHaveBeenCalledWith(CONFIG_Y);
    expect(buildConnector).not.toHaveBeenCalledWith(CONFIG_X);
  });
});
