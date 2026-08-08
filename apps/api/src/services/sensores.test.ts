import { describe, expect, it } from "vitest";
import {
  bateriaPct,
  bloqueado,
  comunicando,
  derivarEventos,
  ignicao,
  lerSensores,
  movendo,
  rastreando,
  resumoSensor,
  rotuloSensor,
  sensoresParaExibir,
  severidadeSensor,
  type MapaSensores,
} from "@isphub/shared";
import { DICIONARIO_PTK } from "./__fixtures__/ptkDicionario.js";

/**
 * Os testes das regras puras de sensor.
 *
 * Moram na API (e nao em `packages/shared`) porque so este workspace tem vitest
 * configurado — mesmo arranjo de `frota.test.ts` e `geodesia.test.ts`.
 */

/** Resposta REAL de `GET /trackers/status` do rastreador 496538. */
const STATUS_REAL = [
  { name: "COMMUNICATION", status: "UP" },
  { name: "TRACKING", status: "OFF" },
  { name: "MOVEMENT", status: "UNDEFINED" },
  { name: "ACC", status: "OFF" },
  { name: "CUT", status: "OFF" },
  { name: "BAT", status: "100" },
];

/** Rastreador 496384, offline: o fornecedor manda UM sensor so. */
const STATUS_OFFLINE = [{ name: "COMMUNICATION", status: "DOWN" }];

describe("lerSensores", () => {
  it("guarda o mapa inteiro, inclusive sensor que o codigo nao conhece", () => {
    const m = lerSensores([...STATUS_REAL, { name: "SENSOR_QUE_NAO_EXISTE_AINDA", status: "42" }]);
    expect(Object.keys(m)).toHaveLength(7);
    expect(m.SENSOR_QUE_NAO_EXISTE_AINDA).toBe("42");
  });

  it("ignora entrada malformada em vez de estourar", () => {
    const m = lerSensores([
      { name: "ACC", status: "ON" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: "SEM_STATUS" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      null as any,
    ]);
    expect(m).toEqual({ ACC: "ON" });
  });

  it("lista vazia e ausente viram mapa vazio", () => {
    expect(lerSensores([])).toEqual({});
    expect(lerSensores(null)).toEqual({});
    expect(lerSensores(undefined)).toEqual({});
  });
});

describe("leitura tri-estado", () => {
  const real = lerSensores(STATUS_REAL);
  const offline = lerSensores(STATUS_OFFLINE);

  it("le os literais do aparelho real", () => {
    expect(comunicando(real)).toBe(true);
    expect(rastreando(real)).toBe(false);
    expect(ignicao(real)).toBe("desligada");
    expect(bloqueado(real)).toBe(false);
    expect(bateriaPct(real)).toBe(100);
  });

  it("MOVEMENT: UNDEFINED e 'nao sabemos', nunca 'parado'", () => {
    // O aparelho real responde isto. Traduzir pra `false` faria o mapa afirmar
    // que o carro esta parado sem ninguem ter medido.
    expect(movendo(real)).toBeNull();
  });

  it("sensor ausente e null, e nao false", () => {
    // O rastreador offline manda SO o COMMUNICATION.
    expect(comunicando(offline)).toBe(false);
    expect(rastreando(offline)).toBeNull();
    expect(movendo(offline)).toBeNull();
    expect(ignicao(offline)).toBeNull();
    expect(bloqueado(offline)).toBeNull();
    expect(bateriaPct(offline)).toBeNull();
  });

  it("aceita a grafia True/False que o fornecedor mistura", () => {
    expect(comunicando({ COMMUNICATION: "True" })).toBe(true);
    expect(comunicando({ COMMUNICATION: "False" })).toBe(false);
  });

  it("valor novo do fornecedor entra como desconhecido, nao como negativo", () => {
    expect(bloqueado({ CUT: "MANUTENCAO" })).toBeNull();
    expect(rastreando({ TRACKING: "SEI_LA" })).toBeNull();
  });

  it("ignicao tem tres estados: ANOMALY nao e 'desligada'", () => {
    expect(ignicao({ ACC: "ON" })).toBe("ligada");
    expect(ignicao({ ACC: "OFF" })).toBe("desligada");
    // Se anomalia virasse "desligada", a viagem fecharia sozinha por defeito de
    // sensor — e o relatorio diria que o tecnico chegou.
    expect(ignicao({ ACC: "ANOMALY" })).toBe("anomalia");
  });

  it("bateria nao numerica nao vira NaN", () => {
    expect(bateriaPct({ BAT: "" })).toBeNull();
    expect(bateriaPct({ BAT: "n/a" })).toBeNull();
    expect(bateriaPct({ BAT: "14.6" })).toBe(15);
  });
});

describe("dicionario do fornecedor", () => {
  it("usa o rotulo deles, nao uma traducao minha", () => {
    expect(rotuloSensor(DICIONARIO_PTK, "ACC")).toBe("IGNIÇÃO");
    expect(rotuloSensor(DICIONARIO_PTK, "BAT")).toBe("BATERIA");
    expect(rotuloSensor(DICIONARIO_PTK, "CUT")).toBe("BLOQUEIO");
  });

  it("sensor fora do dicionario cai no proprio nome", () => {
    expect(rotuloSensor(DICIONARIO_PTK, "FUTURO")).toBe("FUTURO");
    expect(rotuloSensor(null, "ACC")).toBe("ACC");
  });

  it("as faixas de bateria sao as DELES", () => {
    expect(severidadeSensor(DICIONARIO_PTK, "BAT", "1")).toBe("danger");
    expect(severidadeSensor(DICIONARIO_PTK, "BAT", "15")).toBe("danger");
    expect(severidadeSensor(DICIONARIO_PTK, "BAT", "16")).toBe("warning");
    expect(severidadeSensor(DICIONARIO_PTK, "BAT", "35")).toBe("warning");
    expect(severidadeSensor(DICIONARIO_PTK, "BAT", "36")).toBe("success");
  });

  it("BAT 100 cai fora de todas as faixas do fornecedor e ainda assim classifica", () => {
    // As faixas param em 99; o aparelho reporta 100. Sem grampear na borda, a
    // bateria CHEIA seria a unica sem cor na tela.
    expect(severidadeSensor(DICIONARIO_PTK, "BAT", "100")).toBe("success");
    // E o texto tem de ser o numero MEDIDO, com a unidade deles.
    expect(resumoSensor(DICIONARIO_PTK, "BAT", "100")).toBe("100%");
  });

  it("EXTERNAL_BATTERY so tem faixa, sem nenhum valor listado", () => {
    expect(severidadeSensor(DICIONARIO_PTK, "EXTERNAL_BATTERY", "12")).toBe("success");
    expect(resumoSensor(DICIONARIO_PTK, "EXTERNAL_BATTERY", "12")).toBe("12V");
  });

  it("temperatura negativa fica dentro da faixa (-50 a 100)", () => {
    expect(severidadeSensor(DICIONARIO_PTK, "TEMPERATURE", "-10")).toBe("success");
    expect(resumoSensor(DICIONARIO_PTK, "TEMPERATURE", "-10")).toBe("-10ºC");
  });

  it("le as duas grafias de booleano que o fornecedor mistura", () => {
    expect(severidadeSensor(DICIONARIO_PTK, "COMMUNICATION", "True")).toBe("success");
    expect(severidadeSensor(DICIONARIO_PTK, "SUNTECH_INPUT_TWO", "true")).toBe("success");
    expect(severidadeSensor(DICIONARIO_PTK, "SUNTECH_INPUT_TWO", "TRUE")).toBe("success");
  });

  it("valor que o fornecedor nao descreve fica sem cor e mostra o cru", () => {
    // `CUT` documenta so o `ON`. O `OFF` de todo dia nao tem descricao.
    expect(severidadeSensor(DICIONARIO_PTK, "CUT", "OFF")).toBeNull();
    expect(resumoSensor(DICIONARIO_PTK, "CUT", "OFF")).toBe("OFF");
    expect(severidadeSensor(DICIONARIO_PTK, "CUT", "ON")).toBe("danger");
    expect(resumoSensor(DICIONARIO_PTK, "CUT", "ON")).toBe("Bloqueado");
  });

  it("ignicao desligada NAO e problema para o fornecedor", () => {
    expect(severidadeSensor(DICIONARIO_PTK, "ACC", "OFF")).toBe("success");
    expect(severidadeSensor(DICIONARIO_PTK, "ACC", "ANOMALY")).toBe("warning");
  });
});

describe("sensoresParaExibir", () => {
  it("prepara todos, inclusive o que o codigo nao conhece", () => {
    const m = lerSensores([...STATUS_REAL, { name: "TEMPERATURE", status: "23" }]);
    const lista = sensoresParaExibir(m, DICIONARIO_PTK);

    const temp = lista.find((s) => s.nome === "TEMPERATURE");
    // Nenhuma linha de codigo conhece TEMPERATURE — o dicionario resolve tudo.
    expect(temp).toMatchObject({ rotulo: "TEMPERATURA", resumo: "23ºC", severidade: "success" });

    expect(lista).toHaveLength(7);
  });

  it("usa o icone da FAIXA, que carrega o quanto a bateria caiu", () => {
    const cheia = sensoresParaExibir({ BAT: "90" }, DICIONARIO_PTK)[0];
    const fraca = sensoresParaExibir({ BAT: "10" }, DICIONARIO_PTK)[0];
    expect(cheia?.icone).toBe("battery-4");
    expect(fraca?.icone).toBe("battery-0");
  });

  it("sem dicionario nenhum, ainda mostra nome e valor crus", () => {
    const lista = sensoresParaExibir({ ACC: "ON", XPTO: "7" }, null);
    expect(lista).toEqual([
      { nome: "ACC", rotulo: "ACC", valor: "ON", resumo: "ON", severidade: null, icone: null },
      { nome: "XPTO", rotulo: "XPTO", valor: "7", resumo: "7", severidade: null, icone: null },
    ]);
  });
});

// ---------------------------------------------------------------------------

const OPCOES = { limiteVelocidadeKmh: 100 };
const m = (mapa: MapaSensores) => ({ mapa });

describe("derivarEventos", () => {
  it("a transicao gera evento", () => {
    expect(derivarEventos(m({ ACC: "OFF" }), m({ ACC: "ON" }), OPCOES)).toEqual([{ tipo: "ignicao_ligada" }]);
    expect(derivarEventos(m({ ACC: "ON" }), m({ ACC: "OFF" }), OPCOES)).toEqual([{ tipo: "ignicao_desligada" }]);
  });

  it("NAO alerta duas vezes no mesmo estado", () => {
    // A regra que separa um sino util de um que todo mundo ignora.
    expect(derivarEventos(m({ ACC: "ON" }), m({ ACC: "ON" }), OPCOES)).toEqual([]);
    expect(derivarEventos(m({ BAT: "12" }), m({ BAT: "12" }), OPCOES)).toEqual([]);
    expect(derivarEventos(m({ BAT: "12" }), m({ BAT: "11" }), OPCOES)).toEqual([]);
    expect(derivarEventos(m({ CUT: "ON" }), m({ CUT: "ON" }), OPCOES)).toEqual([]);
    expect(derivarEventos(m({ COMMUNICATION: "DOWN" }), m({ COMMUNICATION: "DOWN" }), OPCOES)).toEqual([]);
  });

  it("primeira leitura do aparelho nao inventa transicao", () => {
    // Sem estado anterior nao houve MUDANCA, houve descoberta. Anunciar "ficou
    // offline" pra um rastreador que ja nasceu offline seria mentira.
    expect(derivarEventos(null, m({ COMMUNICATION: "DOWN" }), OPCOES)).toEqual([]);
    expect(derivarEventos(null, m({ ACC: "OFF" }), OPCOES)).toEqual([]);
    // Mas ignicao LIGADA na primeira leitura abre viagem — e um fato, nao uma
    // suposicao sobre o passado.
    expect(derivarEventos(null, m({ ACC: "ON" }), OPCOES)).toEqual([{ tipo: "ignicao_ligada" }]);
  });

  it("sensor que sumiu (aparelho caiu) nao gera evento", () => {
    // O rastreador offline para de mandar ACC. Isso nao e "desligou o motor".
    expect(derivarEventos(m({ ACC: "ON", COMMUNICATION: "UP" }), m({ COMMUNICATION: "UP" }), OPCOES)).toEqual([]);
  });

  it("sensor que VOLTOU depois de um minuto offline nao inventa transicao", () => {
    /*
     * O caso que mais assusta, e que acontece toda vez que o aparelho pisca:
     * quando ele cai, o fornecedor manda SO o COMMUNICATION. O snapshot daquele
     * minuto nao tem ACC nenhum. Na volta, um motor que ficou ligado o tempo
     * todo apareceria como "acabou de ligar" — alerta falso no sino e uma
     * VIAGEM que o carro nao fez.
     */
    const offline = m({ COMMUNICATION: "DOWN" });
    const voltou = m({ COMMUNICATION: "UP", ACC: "ON", BAT: "12", CUT: "ON" });
    expect(derivarEventos(offline, voltou, OPCOES).map((e) => e.tipo)).toEqual(["voltou_online"]);
  });

  it("mas na PRIMEIRA leitura o mesmo estado vira evento — e descoberta, nao ignorancia", () => {
    const primeiro = derivarEventos(null, m({ COMMUNICATION: "UP", ACC: "ON", BAT: "12", CUT: "ON" }), OPCOES);
    expect(primeiro.map((e) => e.tipo).sort()).toEqual(["bateria_baixa", "bloqueio_ativado", "ignicao_ligada"]);
  });

  it("bateria: alerta ao CRUZAR o limite, e normaliza ao voltar", () => {
    expect(derivarEventos(m({ BAT: "20" }), m({ BAT: "14" }), OPCOES)).toEqual([
      { tipo: "bateria_baixa", detalhe: { pct: 14 } },
    ]);
    expect(derivarEventos(m({ BAT: "14" }), m({ BAT: "40" }), OPCOES)).toEqual([
      { tipo: "bateria_normalizada", detalhe: { pct: 40 } },
    ]);
    // Exatamente no limite (15%) ja e faixa `danger` do fornecedor.
    expect(derivarEventos(m({ BAT: "16" }), m({ BAT: "15" }), OPCOES)).toEqual([
      { tipo: "bateria_baixa", detalhe: { pct: 15 } },
    ]);
  });

  it("bateria ja baixa na primeira leitura alerta uma vez", () => {
    expect(derivarEventos(null, m({ BAT: "9" }), OPCOES)).toEqual([{ tipo: "bateria_baixa", detalhe: { pct: 9 } }]);
  });

  it("bloqueio e comunicacao", () => {
    expect(derivarEventos(m({ CUT: "OFF" }), m({ CUT: "ON" }), OPCOES)).toEqual([{ tipo: "bloqueio_ativado" }]);
    expect(derivarEventos(m({ CUT: "ON" }), m({ CUT: "OFF" }), OPCOES)).toEqual([{ tipo: "bloqueio_removido" }]);
    expect(derivarEventos(m({ COMMUNICATION: "UP" }), m({ COMMUNICATION: "DOWN" }), OPCOES)).toEqual([
      { tipo: "ficou_offline" },
    ]);
    expect(derivarEventos(m({ COMMUNICATION: "DOWN" }), m({ COMMUNICATION: "UP" }), OPCOES)).toEqual([
      { tipo: "voltou_online" },
    ]);
  });

  it("ignicao com problema tem evento proprio", () => {
    expect(derivarEventos(m({ ACC: "ON" }), m({ ACC: "ANOMALY" }), OPCOES)).toEqual([{ tipo: "ignicao_anomalia" }]);
  });

  it("velocidade alerta ao SUBIR acima do limite, e nao a cada leitura", () => {
    const antes = { mapa: {}, velocidadeKmh: 90 };
    const cruzou = { mapa: {}, velocidadeKmh: 118 };
    expect(derivarEventos(antes, cruzou, OPCOES)).toEqual([
      { tipo: "excesso_velocidade", detalhe: { velocidadeKmh: 118, limite: 100 } },
    ]);
    // Continuar a 118 nao gera um segundo alerta.
    expect(derivarEventos(cruzou, { mapa: {}, velocidadeKmh: 118 }, OPCOES)).toEqual([]);
    expect(derivarEventos(cruzou, { mapa: {}, velocidadeKmh: 95 }, OPCOES)).toEqual([]);
  });

  it("varias mudancas de uma vez viram varios eventos", () => {
    const eventos = derivarEventos(
      { mapa: { ACC: "OFF", BAT: "50", COMMUNICATION: "DOWN" }, velocidadeKmh: 0 },
      { mapa: { ACC: "ON", BAT: "10", COMMUNICATION: "UP" }, velocidadeKmh: 130 },
      OPCOES,
    );
    expect(eventos.map((e) => e.tipo).sort()).toEqual([
      "bateria_baixa",
      "excesso_velocidade",
      "ignicao_ligada",
      "voltou_online",
    ]);
  });
});
