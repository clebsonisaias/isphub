import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@isphub/shared";
import type { JwtPayload } from "./authService.js";

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { agendamento: { count: vi.fn() } } }));
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

import {
  assertProvedorPermitido,
  escopoOsWhere,
  escopoVeiculoWhere,
  exigirAgendamentosNoEscopo,
  exigirEscopoTotal,
  filtroProvedor,
  podeAcessarOs,
  podeAcessarVeiculo,
  podeProvedor,
  provedoresDoUsuario,
  whereInternosDoProvedor,
} from "./escopoService.js";

function usuario(role: UserRole, overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: "user-1", email: "x@x.com", role, provedorId: null, ...overrides };
}

describe("escopoOsWhere", () => {
  it("provedor: restringe ao proprio provedorId, ignorando filtro da query", () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    expect(escopoOsWhere(u, "prov-outro")).toEqual({ provedorId: "prov-1" });
  });

  it("provedor sem provedorId cai no sentinela (nao ve a fila geral)", () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: null });
    expect(escopoOsWhere(u)).toEqual({ provedorId: "__nenhum__" });
  });

  it("tecnico: restringe as OS em que ele e responsavel OU apoio, sem filtro de provedor", () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    expect(escopoOsWhere(u, "qualquer-provedor")).toEqual({
      OR: [{ tecnicoId: "tec-1" }, { apoios: { some: { id: "tec-1" } } }],
    });
  });

  it("admin: sem restricao, mas respeita o filtro de provedor da query se informado", () => {
    const u = usuario(UserRole.ADMIN);
    expect(escopoOsWhere(u, "prov-1")).toEqual({ provedorId: "prov-1" });
    expect(escopoOsWhere(u)).toEqual({});
  });

  it("gestor: sem restricao, mesmo comportamento do admin", () => {
    const u = usuario(UserRole.GESTOR);
    expect(escopoOsWhere(u, "prov-1")).toEqual({ provedorId: "prov-1" });
    expect(escopoOsWhere(u)).toEqual({});
  });
});

describe("podeAcessarOs", () => {
  const os = { provedorId: "prov-1", tecnicoId: "tec-1" };

  it("provedor: so acessa OS do proprio provedor", () => {
    expect(podeAcessarOs(usuario(UserRole.PROVEDOR, { provedorId: "prov-1" }), os)).toBe(true);
    expect(podeAcessarOs(usuario(UserRole.PROVEDOR, { provedorId: "prov-2" }), os)).toBe(false);
  });

  it("tecnico: so acessa OS atribuida a ele mesmo, de qualquer provedor", () => {
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-1" }), os)).toBe(true);
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-2" }), os)).toBe(false);
  });

  it("tecnico: nao acessa OS sem tecnico atribuido", () => {
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-1" }), { ...os, tecnicoId: null })).toBe(false);
  });

  it("tecnico de apoio: acessa a OS em que e apoio, mesmo com outro responsavel ou sem responsavel", () => {
    const apoio = usuario(UserRole.TECNICO, { sub: "tec-2" });
    expect(podeAcessarOs(apoio, { ...os, apoios: [{ id: "tec-2" }] })).toBe(true);
    expect(podeAcessarOs(apoio, { ...os, tecnicoId: null, apoios: [{ id: "tec-2" }] })).toBe(true);
    expect(podeAcessarOs(apoio, { ...os, apoios: [{ id: "tec-3" }] })).toBe(false);
  });

  it("tecnico: relacao de apoios nao carregada nega (nao libera por engano)", () => {
    expect(podeAcessarOs(usuario(UserRole.TECNICO, { sub: "tec-2" }), { ...os, apoios: undefined })).toBe(false);
  });

  it("admin/gestor: acessam qualquer OS", () => {
    expect(podeAcessarOs(usuario(UserRole.ADMIN), os)).toBe(true);
    expect(podeAcessarOs(usuario(UserRole.GESTOR), os)).toBe(true);
  });
});

/**
 * Regressao de seguranca: conexao/* e fttx/* so barravam role=provedor, entao
 * qualquer tecnico autenticado alcancava o SGP de QUALQUER provedor — listava
 * assinantes, enumerava contrato por contrato e (em fttx) desautorizava ONU,
 * derrubando a fibra de clientes de um ISP com o qual nao tem relacao nenhuma.
 */
describe("assertProvedorPermitido", () => {
  const contarSempre = (n: number) => async () => n;

  it("provedor: passa no proprio", async () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    await expect(assertProvedorPermitido(u, "prov-1", contarSempre(0))).resolves.toBeUndefined();
  });

  it("provedor: barra provedor alheio", async () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    await expect(assertProvedorPermitido(u, "prov-2", contarSempre(99))).rejects.toThrow(/proprio provedor/i);
  });

  it("tecnico: BARRA provedor onde nao tem OS atribuida", async () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    await expect(assertProvedorPermitido(u, "prov-alheio", contarSempre(0))).rejects.toThrow(/sem os atribuida/i);
  });

  it("tecnico: PASSA no provedor onde tem OS atribuida (provisionar a ONU do cliente que atende)", async () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    await expect(assertProvedorPermitido(u, "prov-1", contarSempre(3))).resolves.toBeUndefined();
  });

  it("tecnico: a contagem e feita com o proprio sub e o provedor pedido", async () => {
    const u = usuario(UserRole.TECNICO, { sub: "tec-1" });
    const chamadas: Array<[string, string]> = [];
    await assertProvedorPermitido(u, "prov-9", async (tecnicoId, provedorId) => {
      chamadas.push([tecnicoId, provedorId]);
      return 1;
    });
    expect(chamadas).toEqual([["tec-1", "prov-9"]]);
  });

  it("admin/gestor: livres por desenho, sem nem consultar o banco", async () => {
    let consultou = false;
    const contar = async () => {
      consultou = true;
      return 0;
    };
    for (const role of [UserRole.ADMIN, UserRole.GESTOR]) {
      await expect(assertProvedorPermitido(usuario(role), "prov-qualquer", contar)).resolves.toBeUndefined();
    }
    expect(consultou).toBe(false);
  });
});

describe("escopoVeiculoWhere", () => {
  it("provedor: so os proprios — e NUNCA os da hub (provedorId nulo)", () => {
    /*
     * Carro de provedorId nulo e da operacao ISPhub e atende varios provedores.
     * A posicao dele contaria a um ISP quando o concorrente foi atendido. O
     * `where` por igualdade ja exclui NULL no Postgres, e este teste existe pra
     * travar um "OR provedorId IS NULL" bem-intencionado no futuro.
     */
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    expect(escopoVeiculoWhere(u)).toEqual({ provedorId: "prov-1" });
    // Filtro vindo da query nao amplia o escopo dele.
    expect(escopoVeiculoWhere(u, "prov-9")).toEqual({ provedorId: "prov-1" });
  });

  it("provedor SEM provedorId cai na sentinela, nao no 'sem filtro'", () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: null });
    expect(escopoVeiculoWhere(u)).toEqual({ provedorId: "__nenhum__" });
  });

  it("tecnico: TODOS os ativos, e nao so os que ele ja ocupou", () => {
    /*
     * Restringir ao historico tornaria o primeiro uso impossivel — ele precisa
     * escolher uma viatura pra declarar a ocupacao. Ele e pessoal da ISPhub,
     * nao de um provedor.
     */
    expect(escopoVeiculoWhere(usuario(UserRole.TECNICO))).toEqual({ status: { not: "inativo" } });
  });

  it("admin/gestor: sem restricao, mas respeitam o filtro da tela", () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR]) {
      expect(escopoVeiculoWhere(usuario(role))).toEqual({});
      expect(escopoVeiculoWhere(usuario(role), "prov-3")).toEqual({ provedorId: "prov-3" });
    }
  });
});

describe("podeAcessarVeiculo", () => {
  it("provedor alcanca so o proprio", () => {
    const u = usuario(UserRole.PROVEDOR, { provedorId: "prov-1" });
    expect(podeAcessarVeiculo(u, { provedorId: "prov-1" })).toBe(true);
    expect(podeAcessarVeiculo(u, { provedorId: "prov-2" })).toBe(false);
    expect(podeAcessarVeiculo(u, { provedorId: null })).toBe(false);
  });

  it("provedor SEM provedorId nao herda os carros da hub", () => {
    // `null === null` seria `true` numa comparacao ingenua — e ai um usuario
    // provedor mal configurado enxergaria toda a frota da operacao.
    const u = usuario(UserRole.PROVEDOR, { provedorId: null });
    expect(podeAcessarVeiculo(u, { provedorId: null })).toBe(false);
  });

  it("admin, gestor e tecnico alcancam qualquer um", () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO]) {
      expect(podeAcessarVeiculo(usuario(role), { provedorId: null })).toBe(true);
      expect(podeAcessarVeiculo(usuario(role), { provedorId: "prov-7" })).toBe(true);
    }
  });
});

/**
 * GESTOR limitado a uma lista de provedores (`Usuario.provedoresPermitidos`).
 * A lista vem do banco pelo requireAuth (`req.user.provedores`); vazia = todos.
 */
describe("gestor limitado a provedores", () => {
  const limitado = () => usuario(UserRole.GESTOR, { provedores: ["prov-1", "prov-2"] });

  beforeEach(() => vi.clearAllMocks());

  it("provedoresDoUsuario: a lista do gestor; escopado vira o proprio; admin e tecnico, todos", () => {
    expect(provedoresDoUsuario(limitado())).toEqual(["prov-1", "prov-2"]);
    expect(provedoresDoUsuario(usuario(UserRole.ATENDENTE, { provedorId: "prov-9" }))).toEqual(["prov-9"]);
    expect(provedoresDoUsuario(usuario(UserRole.VENDEDOR))).toEqual(["__nenhum__"]);
    expect(provedoresDoUsuario(usuario(UserRole.ADMIN, { provedores: ["prov-1"] }))).toBeNull();
    expect(provedoresDoUsuario(usuario(UserRole.TECNICO))).toBeNull();
  });

  it("filtroProvedor: sem pedido = a lista; pedido dentro = ele; pedido fora = sentinela (nunca 'todos')", () => {
    expect(filtroProvedor(limitado())).toEqual({ provedorId: { in: ["prov-1", "prov-2"] } });
    expect(filtroProvedor(limitado(), "prov-2")).toEqual({ provedorId: "prov-2" });
    expect(filtroProvedor(limitado(), "prov-3")).toEqual({ provedorId: "__nenhum__" });
  });

  it("escopoOsWhere segue o filtroProvedor", () => {
    expect(escopoOsWhere(limitado())).toEqual({ provedorId: { in: ["prov-1", "prov-2"] } });
    expect(escopoOsWhere(limitado(), "prov-1")).toEqual({ provedorId: "prov-1" });
    expect(escopoOsWhere(limitado(), "prov-3")).toEqual({ provedorId: "__nenhum__" });
  });

  it("podeAcessarOs: so OS dos provedores da lista", () => {
    expect(podeAcessarOs(limitado(), { provedorId: "prov-1", tecnicoId: null })).toBe(true);
    expect(podeAcessarOs(limitado(), { provedorId: "prov-3", tecnicoId: null })).toBe(false);
  });

  it("veiculo: os da lista E os da hub (nulo); filtro da tela fora da lista vira sentinela", () => {
    expect(escopoVeiculoWhere(limitado())).toEqual({
      OR: [{ provedorId: { in: ["prov-1", "prov-2"] } }, { provedorId: null }],
    });
    expect(escopoVeiculoWhere(limitado(), "prov-3")).toEqual({ provedorId: "__nenhum__" });
    expect(podeAcessarVeiculo(limitado(), { provedorId: null })).toBe(true);
    expect(podeAcessarVeiculo(limitado(), { provedorId: "prov-2" })).toBe(true);
    expect(podeAcessarVeiculo(limitado(), { provedorId: "prov-3" })).toBe(false);
  });

  it("assertProvedorPermitido: 403 fora da lista, passa dentro, sem consultar OS", async () => {
    const contar = vi.fn(async () => 0);
    await expect(assertProvedorPermitido(limitado(), "prov-3", contar)).rejects.toMatchObject({ status: 403 });
    await expect(assertProvedorPermitido(limitado(), "prov-1", contar)).resolves.toBeUndefined();
    expect(contar).not.toHaveBeenCalled();
  });

  it("exigirEscopoTotal: barra o limitado, deixa admin e gestor sem lista", () => {
    expect(() => exigirEscopoTotal(limitado())).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => exigirEscopoTotal(usuario(UserRole.ADMIN))).not.toThrow();
    expect(() => exigirEscopoTotal(usuario(UserRole.GESTOR, { provedores: [] }))).not.toThrow();
  });

  it("exigirAgendamentosNoEscopo: lote misto = 403; ids repetidos contam uma vez", async () => {
    mockPrisma.agendamento.count.mockResolvedValue(1);
    await expect(exigirAgendamentosNoEscopo(limitado(), ["a", "b"])).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.agendamento.count).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, provedorId: { in: ["prov-1", "prov-2"] } },
    });

    await expect(exigirAgendamentosNoEscopo(limitado(), ["a", "a"])).resolves.toBeUndefined();
  });

  it("exigirAgendamentosNoEscopo: admin nem consulta o banco", async () => {
    await exigirAgendamentosNoEscopo(usuario(UserRole.ADMIN), ["a"]);
    expect(mockPrisma.agendamento.count).not.toHaveBeenCalled();
  });

  it("whereInternosDoProvedor: admin, ou gestor sem lista, ou com o provedor na lista", () => {
    expect(whereInternosDoProvedor("prov-1")).toEqual({
      OR: [
        { role: UserRole.ADMIN },
        { role: UserRole.GESTOR, OR: [{ provedoresPermitidos: { isEmpty: true } }, { provedoresPermitidos: { has: "prov-1" } }] },
      ],
    });
  });

  it("regressao: gestor com lista VAZIA continua igual ao admin", async () => {
    const semLimite = usuario(UserRole.GESTOR, { provedores: [] });
    const admin = usuario(UserRole.ADMIN);
    expect(provedoresDoUsuario(semLimite)).toBeNull();
    expect(escopoOsWhere(semLimite)).toEqual(escopoOsWhere(admin));
    expect(escopoOsWhere(semLimite, "prov-9")).toEqual(escopoOsWhere(admin, "prov-9"));
    expect(escopoVeiculoWhere(semLimite)).toEqual({});
    expect(podeProvedor(semLimite, "qualquer")).toBe(true);
    expect(podeAcessarOs(semLimite, { provedorId: "qualquer", tecnicoId: null })).toBe(true);
    await expect(assertProvedorPermitido(semLimite, "qualquer", async () => 0)).resolves.toBeUndefined();
  });
});
