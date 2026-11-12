import { beforeEach, describe, expect, it, vi } from "vitest";
import { agruparLinhaDoVeiculo, type ItemLinhaVeiculo } from "@isphub/shared";

const f = {
  ocupacao: vi.fn(),
  checklist: vi.fn(),
  abastecimento: vi.fn(),
  manutencao: vi.fn(),
  evento: vi.fn(),
  fixa: vi.fn(),
  usuarios: vi.fn(),
};
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    ocupacaoVeiculo: { findMany: (a: unknown) => f.ocupacao(a) },
    checklistViatura: { findMany: (a: unknown) => f.checklist(a) },
    abastecimento: { findMany: (a: unknown) => f.abastecimento(a) },
    manutencaoRealizada: { findMany: (a: unknown) => f.manutencao(a) },
    eventoRastreador: { findMany: (a: unknown) => f.evento(a) },
    viaturaFixa: { findMany: (a: unknown) => f.fixa(a) },
    usuario: { findMany: (a: unknown) => f.usuarios(a) },
  },
}));

const { linhaDoVeiculo, TETO_POR_FONTE } = await import("./linhaDoVeiculoService.js");

const pessoa = (nome: string) => ({ nome, nomeExibicao: null });
const t = (iso: string) => new Date(iso);

describe("agruparLinhaDoVeiculo", () => {
  const item = (tipo: ItemLinhaVeiculo["tipo"], em: string, extra: object = {}) => ({ tipo, em, ...extra }) as ItemLinhaVeiculo;

  it("agrupa pelo dia de Brasilia: 23h30 BR fica no dia, mesmo ja sendo amanha em UTC", () => {
    const dias = agruparLinhaDoVeiculo([item("alarme", "2026-11-07T02:30:00Z"), item("alarme", "2026-11-06T15:00:00Z")]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-11-06"]);
    expect(dias[0]!.itens).toHaveLength(2);
  });

  it("dias do mais recente pro mais antigo; dentro do dia, em ordem cronologica", () => {
    const dias = agruparLinhaDoVeiculo([
      item("alarme", "2026-11-05T12:00:00Z"),
      item("devolucao", "2026-11-06T20:00:00Z"),
      item("retirada", "2026-11-06T11:00:00Z"),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-11-06", "2026-11-05"]);
    expect(dias[0]!.itens.map((i) => i.tipo)).toEqual(["retirada", "devolucao"]);
  });

  it("no mesmo instante conta a historia: retirada, checklist de saida... checklist de retorno, devolucao", () => {
    const em = "2026-11-06T11:00:00Z";
    const dias = agruparLinhaDoVeiculo([
      item("devolucao", em),
      item("checklist", em, { momento: "retorno" }),
      item("checklist", em, { momento: "saida" }),
      item("retirada", em),
      item("carro_fixo", em),
    ]);
    expect(dias[0]!.itens.map((i) => (i.tipo === "checklist" ? `checklist:${i.momento}` : i.tipo))).toEqual([
      "carro_fixo",
      "retirada",
      "checklist:saida",
      "checklist:retorno",
      "devolucao",
    ]);
  });

  it("abastecimento (so tem data) vai pro comeco do dia em vez de inventar hora", () => {
    const dias = agruparLinhaDoVeiculo([item("retirada", "2026-11-06T10:00:00Z"), item("abastecimento", "2026-11-06T15:00:00Z")]);
    expect(dias[0]!.itens[0]!.tipo).toBe("abastecimento");
  });

  it("sem itens, sem dias", () => {
    expect(agruparLinhaDoVeiculo([])).toEqual([]);
  });
});

describe("linhaDoVeiculo (servico)", () => {
  beforeEach(() => {
    for (const fn of Object.values(f)) fn.mockReset().mockResolvedValue([]);
  });

  it("junta as seis fontes, com nomes e sem a foto em bytes", async () => {
    f.ocupacao.mockResolvedValue([
      {
        inicioEm: t("2026-11-06T11:00:00Z"),
        fimEm: t("2026-11-06T20:00:00Z"),
        papel: "motorista",
        origem: "ajuste",
        encerradoPor: "jornada",
        odometroInicio: 1000,
        odometroFim: 1045,
        usuario: pessoa("Ana"),
        declaradoPor: pessoa("Gestor"),
      },
    ]);
    f.checklist.mockResolvedValue([
      { id: "c1", momento: "saida", odometroKm: 1000, combustivelPct: 75, avarias: null, fotoMime: "image/jpeg", criadoEm: t("2026-11-06T11:00:00Z"), usuarioId: "u-ana" },
    ]);
    f.abastecimento.mockResolvedValue([
      { data: t("2026-11-06T00:00:00Z"), km: 1020, litros: "35.5", valorTotal: "210.40", combustivel: "gasolina", posto: "Posto X", tanqueCheio: true, responsavel: pessoa("Ana") },
    ]);
    f.manutencao.mockResolvedValue([{ tipo: "Troca de óleo", km: 1030, em: t("2026-11-06T18:00:00Z"), registradoPor: "u-gestor" }]);
    f.evento.mockResolvedValue([{ tipo: "bateria_baixa", em: t("2026-11-06T14:00:00Z") }]);
    f.usuarios.mockResolvedValue([
      { id: "u-ana", nome: "Ana", nomeExibicao: null },
      { id: "u-gestor", nome: "Gestor", nomeExibicao: null },
    ]);

    const r = await linhaDoVeiculo("v1", "2026-11-06", "2026-11-06", t("2026-11-07T00:00:00Z"));
    expect(r.truncado).toBe(false);
    expect(r.dias).toHaveLength(1);
    const tipos = r.dias[0]!.itens.map((i) => i.tipo);
    expect(tipos).toEqual(["abastecimento", "retirada", "checklist", "alarme", "manutencao", "devolucao"]);

    const [abast, retirada, checklist, alarme, manut] = r.dias[0]!.itens;
    expect(abast).toMatchObject({ litros: 35.5, valorTotal: 210.4, semHora: true, responsavelNome: "Ana" });
    expect(retirada).toMatchObject({ usuarioNome: "Ana", origem: "ajuste", declaradoPorNome: "Gestor", odometroKm: 1000 });
    expect(checklist).toMatchObject({ id: "c1", temFoto: true, usuarioNome: "Ana", combustivelPct: 75 });
    expect(checklist).not.toHaveProperty("fotoPainel");
    expect(alarme).toMatchObject({ evento: "bateria_baixa", grave: true });
    expect(manut).toMatchObject({ servico: "Troca de óleo", registradoPorNome: "Gestor" });
  });

  it("so pede ao banco os eventos que sao alarme (ignicao liga/desliga fica de fora)", async () => {
    await linhaDoVeiculo("v1", "2026-11-06", "2026-11-06");
    const arg = f.evento.mock.calls[0]![0] as { where: { tipo: { in: string[] } } };
    expect(arg.where.tipo.in).toContain("bateria_baixa");
    expect(arg.where.tipo.in).not.toContain("ignicao_ligada");
  });

  it("ocupacao que comecou antes do periodo aparece so com a devolucao", async () => {
    f.ocupacao.mockResolvedValue([
      {
        inicioEm: t("2026-11-05T11:00:00Z"),
        fimEm: t("2026-11-06T12:00:00Z"),
        papel: "motorista",
        origem: "jornada",
        encerradoPor: "troca_veiculo",
        odometroInicio: null,
        odometroFim: null,
        usuario: pessoa("Ana"),
        declaradoPor: pessoa("Ana"),
      },
    ]);
    const r = await linhaDoVeiculo("v1", "2026-11-06", "2026-11-06");
    expect(r.dias[0]!.itens.map((i) => i.tipo)).toEqual(["devolucao"]);
    expect(r.dias[0]!.itens[0]).toMatchObject({ motivo: "troca_veiculo" });
  });

  it("troca do carro fixo vira dois itens: encerrado de um, definido do outro", async () => {
    f.fixa.mockResolvedValue([
      { inicioEm: t("2026-11-06T13:00:00Z"), fimEm: null, definidoPor: "u-g", encerradoPor: null, usuario: pessoa("Rafael") },
      { inicioEm: t("2026-10-01T13:00:00Z"), fimEm: t("2026-11-06T13:00:00Z"), definidoPor: "u-g", encerradoPor: "u-g", usuario: pessoa("Ana") },
    ]);
    f.usuarios.mockResolvedValue([{ id: "u-g", nome: "Gestor", nomeExibicao: null }]);
    const r = await linhaDoVeiculo("v1", "2026-11-06", "2026-11-06");
    const fixos = r.dias[0]!.itens.filter((i) => i.tipo === "carro_fixo");
    expect(fixos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usuarioNome: "Rafael", acao: "definido", porNome: "Gestor" }),
        expect.objectContaining({ usuarioNome: "Ana", acao: "encerrado", porNome: "Gestor" }),
      ]),
    );
  });

  const alarmes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ tipo: "ficou_offline", em: t(`2026-11-06T1${i % 10}:00:00Z`) }));

  it("avisa quando uma fonte PASSA do teto e mostra so ate o teto", async () => {
    f.evento.mockResolvedValue(alarmes(TETO_POR_FONTE + 1));
    const r = await linhaDoVeiculo("v1", "2026-11-06", "2026-11-06");
    expect(r.truncado).toBe(true);
    expect(r.dias.flatMap((d) => d.itens)).toHaveLength(TETO_POR_FONTE);
  });

  it("exatamente no teto nao falta nada: sem aviso", async () => {
    f.evento.mockResolvedValue(alarmes(TETO_POR_FONTE));
    const r = await linhaDoVeiculo("v1", "2026-11-06", "2026-11-06");
    expect(r.truncado).toBe(false);
  });
});
