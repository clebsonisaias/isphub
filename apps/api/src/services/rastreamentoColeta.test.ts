import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RastreadorConnector } from "@isphub/shared";

/**
 * COLETA — o que nao pode acontecer.
 *
 * A regra que este teste protege e uma so, e ela vem de um incidente real em
 * outro conector: `indeterminado` NUNCA vira dado. Uma consulta que falhou nao
 * sabe nada, e gravar um ponto ali poria no historico uma posicao que o carro
 * nunca ocupou — no mapa isso parece dado, nao parece falha.
 */

const { rastreadorFindMany, rastreadorUpdate, posicaoCreateMany, configUpdate, configFindMany } = vi.hoisted(() => ({
  rastreadorFindMany: vi.fn(),
  rastreadorUpdate: vi.fn(),
  posicaoCreateMany: vi.fn(),
  configUpdate: vi.fn(),
  configFindMany: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    rastreador: { findMany: rastreadorFindMany, update: rastreadorUpdate },
    posicaoRastreador: { createMany: posicaoCreateMany },
    rastreadorConfig: { update: configUpdate, findMany: configFindMany },
  },
}));

const { coletarDeUmaConfig, configsVencidas } = await import("./rastreamentoService.js");

const CONFIG = {
  id: "cfg-1",
  provedorId: null,
  fornecedor: "plataformatk" as const,
  baseUrl: "https://exemplo.invalid",
  chaveCifrada: "x",
};

function conector(over: Partial<RastreadorConnector> = {}): RastreadorConnector {
  return {
    testarConexao: async () => ({ ok: true }),
    statusDeTodos: async () => ({ tipo: "lista", itens: [] }),
    ultimaPosicao: async () => ({ tipo: "sem_posicao" }),
    historico: async () => ({ tipo: "trecho", pontos: [] }),
    resumoDeDias: async () => ({ tipo: "resumo", dias: [] }),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rastreadorUpdate.mockResolvedValue({});
  configUpdate.mockResolvedValue({});
  posicaoCreateMany.mockResolvedValue({ count: 0 });
  rastreadorFindMany.mockResolvedValue([{ id: "r-1", identificadorExterno: "496538" }]);
});

describe("coletarDeUmaConfig", () => {
  it("grava a posicao quando o fornecedor responde", async () => {
    const r = await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({
          tipo: "lista",
          itens: [
            { identificadorExterno: "496538", comunicando: true, rastreando: true, movendo: false, ignicao: false, bateriaPct: 100 },
          ],
        }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 0,
        }),
      }),
    );

    expect(posicaoCreateMany).toHaveBeenCalledTimes(1);
    const arg = posicaoCreateMany.mock.calls[0]![0] as { data: unknown[]; skipDuplicates: boolean };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(1);
    expect(r.erro).toBeNull();
  });

  it("NUNCA grava um `indeterminado`", async () => {
    /*
     * O caso: a API caiu, ou o rastreador nao existe (que na PlataformaTK volta
     * 400, nao 404). A ultima posicao conhecida fica de pe e a tela mostra a
     * IDADE dela — velha e rotulada vence inventada.
     */
    await coletarDeUmaConfig(
      CONFIG,
      conector({ ultimaPosicao: async () => ({ tipo: "indeterminado", motivo: "PTK 500" }) }),
    );
    expect(posicaoCreateMany).not.toHaveBeenCalled();
  });

  it("`sem_posicao` tambem nao grava — e nao e erro", async () => {
    const r = await coletarDeUmaConfig(CONFIG, conector());
    expect(posicaoCreateMany).not.toHaveBeenCalled();
    expect(r.erro).toBeNull();
  });

  it("status indisponivel NAO aborta a posicao — sao duas perguntas diferentes", async () => {
    const r = await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "indeterminado", motivo: "PTK 503" }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: 1,
          lng: 2,
          registradoEm: "2026-08-08T02:00:00.000Z",
          velocidadeKmh: null,
        }),
      }),
    );

    expect(posicaoCreateMany).toHaveBeenCalledTimes(1);
    const linha = (posicaoCreateMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    // Sem status, os campos ficam `null` — "nao sabemos", nao `false`.
    expect(linha.movendo).toBeNull();
    expect(linha.comunicando).toBeNull();
    expect(r.statusOk).toBe(false);
    expect(r.erro).toContain("503");
  });

  it("sem rastreador vinculado, nao gasta nem a chamada de status", async () => {
    rastreadorFindMany.mockResolvedValue([]);
    const chamou = vi.fn();
    const r = await coletarDeUmaConfig(CONFIG, conector({ statusDeTodos: chamou as never }));
    expect(chamou).not.toHaveBeenCalled();
    expect(r.consultados).toBe(0);
  });

  it("respeita o teto por tique na consulta", async () => {
    await coletarDeUmaConfig(CONFIG, conector());
    // 40 = 1 status + 40 posicoes <= 41 req/min, abaixo do teto do fornecedor.
    expect((rastreadorFindMany.mock.calls[0]![0] as { take: number }).take).toBe(40);
  });
});

describe("configsVencidas", () => {
  const agora = new Date("2026-08-08T12:00:00.000Z");

  it("credencial que nunca coletou entra", async () => {
    configFindMany.mockResolvedValue([{ id: "c1", ultimaColetaEm: null, intervaloPollingSegundos: 60 }]);
    expect(await configsVencidas(agora)).toHaveLength(1);
  });

  it("credencial dentro do intervalo fica de fora", async () => {
    configFindMany.mockResolvedValue([
      { id: "c1", ultimaColetaEm: new Date(agora.getTime() - 30_000), intervaloPollingSegundos: 60 },
    ]);
    expect(await configsVencidas(agora)).toHaveLength(0);
  });

  it("credencial com intervalo vencido entra", async () => {
    configFindMany.mockResolvedValue([
      { id: "c1", ultimaColetaEm: new Date(agora.getTime() - 61_000), intervaloPollingSegundos: 60 },
    ]);
    expect(await configsVencidas(agora)).toHaveLength(1);
  });
});
