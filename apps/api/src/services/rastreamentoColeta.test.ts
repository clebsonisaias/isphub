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

const {
  rastreadorFindMany,
  rastreadorUpdate,
  posicaoCreateMany,
  configUpdate,
  configFindMany,
  eventoCreateMany,
  posicaoFindMany,
  viagemFindFirst,
  viagemCreate,
  viagemUpdateMany,
  ocupacaoFindFirst,
} = vi.hoisted(() => ({
  rastreadorFindMany: vi.fn(),
  rastreadorUpdate: vi.fn(),
  posicaoCreateMany: vi.fn(),
  configUpdate: vi.fn(),
  configFindMany: vi.fn(),
  eventoCreateMany: vi.fn(),
  posicaoFindMany: vi.fn(),
  viagemFindFirst: vi.fn(),
  viagemCreate: vi.fn(),
  viagemUpdateMany: vi.fn(),
  ocupacaoFindFirst: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    rastreador: { findMany: rastreadorFindMany, update: rastreadorUpdate },
    posicaoRastreador: { createMany: posicaoCreateMany, findMany: posicaoFindMany },
    rastreadorConfig: { update: configUpdate, findMany: configFindMany },
    eventoRastreador: { createMany: eventoCreateMany },
    viagem: { findFirst: viagemFindFirst, create: viagemCreate, updateMany: viagemUpdateMany },
    ocupacaoVeiculo: { findFirst: ocupacaoFindFirst },
  },
}));

/** Um rastreador como o `select` da coleta o devolve — com o vinculo aberto. */
function rastreadorNoBanco() {
  return { id: "r-1", identificadorExterno: "496538", vinculos: [{ veiculoId: "v-1" }] };
}

/**
 * A POSICAO anterior — de onde sai o estado com que a nova e comparada.
 * `null` (o padrao) = nunca coletamos, e so ai a leitura vira descoberta.
 */
function posicaoAnterior(sensores: MapaSensores | null, velocidadeKmh: number | null = 0) {
  return [{ sensores, velocidadeKmh }];
}

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
  posicaoCreateMany.mockResolvedValue({ count: 1 });
  eventoCreateMany.mockResolvedValue({ count: 0 });
  posicaoFindMany.mockResolvedValue([]);
  viagemFindFirst.mockResolvedValue(null);
  viagemCreate.mockResolvedValue({ id: "vg-1" });
  viagemUpdateMany.mockResolvedValue({ count: 1 });
  ocupacaoFindFirst.mockResolvedValue(null);
  rastreadorFindMany.mockResolvedValue([rastreadorNoBanco()]);
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

  it("deriva evento e ABRE viagem quando a ignicao liga", async () => {
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON" })] }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 20,
        }),
      }),
    );

    const evento = (eventoCreateMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    expect(evento.tipo).toBe("ignicao_ligada");
    /*
     * O `em` e o carimbo DO APARELHO, nunca `new Date()`.
     *
     * A chave natural do evento e (rastreadorId, tipo, em). Duas replicas
     * derivam o MESMO evento do mesmo par de leituras — mas so concordam no
     * `em` se ele vier do dispositivo. Com o relogio do servidor, cada replica
     * gravaria um `em` diferente, o unique nao deduplicaria nada, e o sino
     * tocaria duas vezes.
     */
    expect((evento.em as Date).toISOString()).toBe("2026-08-08T02:49:42.000Z");
    expect(viagemCreate).toHaveBeenCalledTimes(1);
    expect((viagemCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data.veiculoId).toBe("v-1");
  });

  it("aparelho que volta do offline NAO inventa ignicao ligada nem viagem", async () => {
    /*
     * O caso mais perigoso do modulo, e o mais comum: quando o rastreador cai, o
     * fornecedor manda SO o COMMUNICATION, e o snapshot daquele minuto fica sem
     * ACC. Na volta, um motor que nunca desligou pareceria "acabou de ligar" —
     * alerta falso no sino e uma VIAGEM que o carro nao fez.
     */
    posicaoFindMany.mockResolvedValue(posicaoAnterior({ COMMUNICATION: "DOWN" }));
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON" })] }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 0,
        }),
      }),
    );

    const tipos = (eventoCreateMany.mock.calls[0]?.[0] as { data: Record<string, unknown>[] } | undefined)?.data.map(
      (e) => e.tipo,
    );
    expect(tipos).toEqual(["voltou_online"]);
    /*
     * A VIAGEM, porem, ABRE — e esta certo. Evento responde "o que mudou" (nada
     * mudou: nao sabiamos). Viagem responde "o motor esta ligado agora?" (esta).
     * Sao perguntas diferentes e podem divergir sem contradicao.
     */
    expect(viagemCreate).toHaveBeenCalledTimes(1);
  });

  it("acumula na viagem ABERTA em vez de abrir outra", async () => {
    viagemFindFirst.mockResolvedValue({
      id: "vg-existente",
      rastreadorId: "r-1",
      inicioEm: new Date("2026-08-08T02:00:00.000Z"),
      latInicio: -5.85,
      lngInicio: -35.34,
      latFim: -5.85,
      lngFim: -35.34,
      ultimoEm: new Date("2026-08-08T02:40:00.000Z"),
      ultimaVelocidadeKmh: 30,
      distanciaMetros: 4000,
      velocidadeMaxKmh: 60,
      paradoComMotorLigadoSeg: 0,
    });

    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({
          tipo: "lista",
          itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON" })],
        }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 55,
        }),
      }),
    );

    expect(viagemCreate).not.toHaveBeenCalled();
    const d = (viagemUpdateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(d.distanciaMetros).toBeGreaterThan(4000);
    expect(d.fimEm).toBeUndefined();
  });

  it("ignicao desligada FECHA a viagem aberta", async () => {
    viagemFindFirst.mockResolvedValue({
      id: "vg-existente",
      rastreadorId: "r-1",
      inicioEm: new Date("2026-08-08T02:00:00.000Z"),
      latInicio: -5.85,
      lngInicio: -35.34,
      latFim: -5.85,
      lngFim: -35.34,
      ultimoEm: new Date("2026-08-08T02:45:00.000Z"),
      ultimaVelocidadeKmh: 10,
      distanciaMetros: 4000,
      velocidadeMaxKmh: 60,
      paradoComMotorLigadoSeg: 0,
    });

    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({
          tipo: "lista",
          itens: [status("496538", { COMMUNICATION: "UP", ACC: "OFF" })],
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

    const d = (viagemUpdateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect((d.fimEm as Date).toISOString()).toBe("2026-08-08T02:49:42.000Z");
    expect(viagemCreate).not.toHaveBeenCalled();
  });

  it("excesso de velocidade so alerta ao CRUZAR o limite, nao a cada minuto", async () => {
    /*
     * A guarda de borda depende da velocidade ANTERIOR — e ela so existe na
     * posicao, nao no cache do rastreador. Se o estado anterior chegar sem
     * velocidade, `vAntes === null` libera a condicao e um carro a 118 km/h por
     * dez minutos rende dez alertas identicos.
     */
    posicaoFindMany.mockResolvedValue(posicaoAnterior({ COMMUNICATION: "UP", ACC: "ON" }, 118));
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON" })] }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 120,
        }),
      }),
    );
    // Ja estava acima no ponto anterior: nao ha borda de subida, nao ha alerta.
    expect(eventoCreateMany).not.toHaveBeenCalled();
  });

  it("ponto FORA DE ORDEM e ignorado — a viagem boa nao e destruida", async () => {
    /*
     * O fix antigo faria o delta de tempo ficar negativo e ENCOLHER
     * `paradoComMotorLigadoSeg`, ou somar de novo um trecho ja contado. Mas
     * FECHAR a viagem por causa dele seria pior: um ponto repetido (a mesma
     * leitura chegando duas vezes) partiria a viagem em duas.
     */
    viagemFindFirst.mockResolvedValue({
      id: "vg-existente",
      rastreadorId: "r-1",
      inicioEm: new Date("2026-08-08T03:00:00.000Z"),
      latInicio: -5.85,
      lngInicio: -35.34,
      latFim: -5.85,
      lngFim: -35.34,
      ultimoEm: new Date("2026-08-08T03:40:00.000Z"),
      ultimaVelocidadeKmh: 30,
      distanciaMetros: 4000,
      velocidadeMaxKmh: 60,
      paradoComMotorLigadoSeg: 0,
    });

    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON" })] }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          // ANTES do `ultimoEm` da viagem aberta.
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 55,
        }),
      }),
    );

    // A viagem continua aberta e intocada: nem update, nem create.
    expect(viagemUpdateMany).not.toHaveBeenCalled();
    expect(viagemCreate).not.toHaveBeenCalled();
  });

  it("mas ponto de OUTRO APARELHO fecha a viagem e abre uma nova", async () => {
    /*
     * Trocaram o rastreador do veiculo sem encerrar a viagem. Continuar a conta
     * faria a distancia do aparelho novo somar na do antigo, e o trecho entre a
     * ultima posicao de um e a primeira do outro viraria uma reta que ninguem
     * percorreu.
     */
    viagemFindFirst.mockResolvedValue({
      id: "vg-de-outro",
      rastreadorId: "r-ANTIGO",
      inicioEm: new Date("2026-08-08T02:00:00.000Z"),
      latInicio: -5.85,
      lngInicio: -35.34,
      latFim: -5.85,
      lngFim: -35.34,
      ultimoEm: new Date("2026-08-08T02:30:00.000Z"),
      ultimaVelocidadeKmh: 30,
      distanciaMetros: 4000,
      velocidadeMaxKmh: 60,
      paradoComMotorLigadoSeg: 0,
    });

    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { COMMUNICATION: "UP", ACC: "ON" })] }),
        ultimaPosicao: async () => ({
          tipo: "posicao",
          lat: -5.86,
          lng: -35.34,
          registradoEm: "2026-08-08T02:49:42.000Z",
          velocidadeKmh: 55,
        }),
      }),
    );

    const fechamento = (viagemUpdateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect((fechamento.fimEm as Date).toISOString()).toBe("2026-08-08T02:30:00.000Z");
    expect(viagemCreate).toHaveBeenCalledTimes(1);
  });

  it("posicao indeterminada nao deriva nada — nem evento, nem viagem", async () => {
    await coletarDeUmaConfig(
      CONFIG,
      conector({
        statusDeTodos: async () => ({ tipo: "lista", itens: [status("496538", { ACC: "ON" })] }),
        ultimaPosicao: async () => ({ tipo: "indeterminado", motivo: "PTK 500" }),
      }),
    );
    expect(eventoCreateMany).not.toHaveBeenCalled();
    expect(viagemCreate).not.toHaveBeenCalled();
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
