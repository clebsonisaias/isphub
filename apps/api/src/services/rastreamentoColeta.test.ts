import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bateriaPct,
  bloqueado,
  comunicando,
  ignicao,
  movendo,
  rastreando,
  type MapaSensores,
  type RastreadorConnector,
  type StatusRastreador,
} from "@isphub/shared";

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
  /** Recente: o tique NAO deve gastar chamada com cadastro nem dicionario. */
  dicionarioEm: new Date(),
};

/** Status completo a partir do mapa cru — o mesmo caminho que o conector usa. */
function status(identificadorExterno: string, sensores: MapaSensores): StatusRastreador {
  return {
    identificadorExterno,
    sensores,
    comunicando: comunicando(sensores),
    rastreando: rastreando(sensores),
    movendo: movendo(sensores),
    ignicao: ignicao(sensores),
    bateriaPct: bateriaPct(sensores),
    bloqueado: bloqueado(sensores),
  };
}

function conector(over: Partial<RastreadorConnector> = {}): RastreadorConnector {
  return {
    testarConexao: async () => ({ ok: true }),
    statusDeTodos: async () => ({ tipo: "lista", itens: [] }),
    cadastroDeTodos: async () => ({ tipo: "lista", itens: [] }),
    dicionarioDeSensores: async () => ({ tipo: "indeterminado", motivo: "duble sem dicionario" }),
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
          // A resposta REAL do rastreador 496538.
          itens: [
            status("496538", {
              COMMUNICATION: "UP",
              TRACKING: "OFF",
              MOVEMENT: "UNDEFINED",
              ACC: "OFF",
              CUT: "OFF",
              BAT: "100",
            }),
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

  it("grava os sensores que antes eram jogados fora na ultima curva", async () => {
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({
          tipo: "lista",
          itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON", CUT: "ON", BAT: "12", MOVEMENT: "MOVING" })],
        }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 42,
        }),
      }),
    );

    const linha = (posicaoCreateMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    // A ignicao chegava a cada minuto e nunca era gravada — e e ela que faz uma
    // VIAGEM existir.
    expect(linha.ignicao).toBe("ligada");
    expect(linha.bateriaPct).toBe(12);
    // `CUT` nem chegava: caia no `default: break` do switch do conector.
    expect(linha.bloqueado).toBe(true);
    expect(linha.sensores).toEqual({ COMMUNICATION: "UP", ACC: "ON", CUT: "ON", BAT: "12", MOVEMENT: "MOVING" });
  });

  it("guarda sensor DESCONHECIDO sem quebrar — e o que prova o desenho generico", async () => {
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({
          tipo: "lista",
          itens: [status("496538", { ACC: "OFF", TEMPERATURE: "23", SENSOR_DE_PORTA: "ABERTA" })],
        }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: 1,
          lng: 2,
          registradoEm: "2026-08-08T03:00:00.000Z",
          velocidadeKmh: null,
        }),
      }),
    );

    const linha = (posicaoCreateMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    // Nenhuma linha de codigo conhece SENSOR_DE_PORTA, e ele chega ao banco
    // inteiro. Amanha ele aparece na tela pelo dicionario, sem migracao.
    expect(linha.sensores).toEqual({ ACC: "OFF", TEMPERATURE: "23", SENSOR_DE_PORTA: "ABERTA" });
  });

  it("ausencia de ACC nao inventa ignicao", async () => {
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        // Rastreador offline: manda SO o COMMUNICATION.
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { COMMUNICATION: "DOWN" })] }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: 1,
          lng: 2,
          registradoEm: "2026-08-08T03:00:00.000Z",
          velocidadeKmh: null,
        }),
      }),
    );

    const linha = (posicaoCreateMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    expect(linha.ignicao).toBeNull();
    expect(linha.bloqueado).toBeNull();
    expect(linha.bateriaPct).toBeNull();
    expect(linha.comunicando).toBe(false);
  });

  it("cadastro e dicionario recentes NAO gastam requisicao no tique", async () => {
    const cadastro = vi.fn(async () => ({ tipo: "lista" as const, itens: [] }));
    const dic = vi.fn(async () => ({ tipo: "dicionario" as const, dados: {} }));
    await coletarDeUmaConfig(CONFIG, conector({ cadastroDeTodos: cadastro, dicionarioDeSensores: dic }));
    expect(cadastro).not.toHaveBeenCalled();
    expect(dic).not.toHaveBeenCalled();
  });

  it("dicionario vencido e buscado, e o que falha NAO carimba a data", async () => {
    const antigo = { ...CONFIG, dicionarioEm: new Date(Date.now() - 48 * 60 * 60_000) };
    const r = await coletarDeUmaConfig(
      antigo,
      conector({ dicionarioDeSensores: async () => ({ tipo: "indeterminado", motivo: "PTK 500" }) }),
    );

    expect(r.dicionarioAtualizado).toBe(false);
    // Carimbar `dicionarioEm` mesmo em falha nos deixaria 24h sem tentar de novo.
    const gravouDicionario = configUpdate.mock.calls.some(
      (c) => (c[0] as { data?: Record<string, unknown> })?.data?.dicionarioEm !== undefined,
    );
    expect(gravouDicionario).toBe(false);
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
