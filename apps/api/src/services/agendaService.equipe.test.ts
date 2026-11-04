import { describe, expect, it, vi } from "vitest";
import { doTurno, ocupacoesEntre } from "./agendaService.js";

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    agendamento: {
      findMany: mockFindMany,
    },
  },
}));

describe("agendaService - separação de equipe interna e retiradas", () => {
  it("doTurno com equipe='interna' aplica filtro de exclusão de retiradas e equipeExterna", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "ag-1",
        sgpOsId: "1001",
        ordemRota: 1,
        regiao: "Centro",
        fila: "normal",
        origem: "painel",
        marcadoPor: "admin",
        observacao: null,
        sgpConfirmadoEm: null,
        confirmadoEm: null,
        solicitouReagendamento: false,
        lembreteEnviadoEm: null,
        remarcacoesCliente: 0,
        provedor: { id: "p1", nome: "Provedor 1", cor: "#000" },
        ordemServico: {
          id: "os-1",
          status: "aberta",
          clienteNome: "Cliente 1",
          telefone: "99999",
          bairro: "Centro",
          logradouro: "Rua 1",
          numero: "10",
          cidade: "Natal",
          pop: "POP 1",
          lat: -5.79,
          lng: -35.2,
          tecnico: { id: "tec-1", nome: "Tecnico 1", nomeExibicao: null },
          apoios: [],
          tipoOs: { descricao: "Instalação", categoria: { nome: "Instalação", cor: "#00f", equipeExterna: false } },
        },
      },
    ]);

    const resultado = await doTurno("2026-11-04", "manha", undefined, "interna");
    expect(resultado).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fila: { not: "retirada" },
          OR: [
            { ordemServicoId: null },
            {
              ordemServico: {
                OR: [
                  { tipoOsId: null },
                  { tipoOs: { categoriaId: null } },
                  { tipoOs: { categoria: { equipeExterna: false } } },
                ],
              },
            },
          ],
        }),
      }),
    );
  });

  it("ocupacoesEntre com equipe='interna' ignora agendamentos de retirada e equipe externa no total", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        dia: new Date("2026-11-04T00:00:00.000Z"),
        turno: "manha",
        regiao: "Centro",
        fila: "normal",
        ordemServico: {
          tipoOs: {
            categoria: { nome: "Instalação", equipeExterna: false },
          },
        },
      },
      {
        dia: new Date("2026-11-04T00:00:00.000Z"),
        turno: "manha",
        regiao: "Centro",
        fila: "retirada",
        ordemServico: {
          tipoOs: {
            categoria: { nome: "Retirada", equipeExterna: true },
          },
        },
      },
      {
        dia: new Date("2026-11-04T00:00:00.000Z"),
        turno: "tarde",
        regiao: "Centro",
        fila: "normal",
        ordemServico: {
          tipoOs: {
            categoria: { nome: "Reparo / Sem conexão", equipeExterna: false },
          },
        },
      },
    ]);

    const mapa = await ocupacoesEntre("2026-11-04", "2026-11-04", undefined, "interna");
    const manha = mapa.get("2026-11-04|manha");
    const tarde = mapa.get("2026-11-04|tarde");

    // A retirada da manhã NÃO deve entrar no total da equipe interna
    expect(manha?.total).toBe(1);
    expect(manha?.instalacao).toBe(1);
    expect(manha?.retirada).toBe(0);

    expect(tarde?.total).toBe(1);
    expect(tarde?.reparo).toBe(1);
  });
});
