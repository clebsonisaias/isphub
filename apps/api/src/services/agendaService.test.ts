import { describe, expect, it } from "vitest";
import type { AgendaConfigDto } from "@isphub/shared";
import type { ExcecaoAgendaDto } from "@isphub/shared";
import {
  chaveJanela,
  podeClienteRemarcar,
  diaBrDe,
  diaDaSemana,
  inicioDoTurno,
  montarGrade,
  proximasVagas,
  resumirMarcacoes,
  somarDias,
  turnoBrDe,
  vagaDe,
  type Ocupacao,
} from "./agendaService.js";

const CONFIG: AgendaConfigDto = {
  vagasManha: 20,
  vagasTarde: 20,
  vagasDia: null,
  tetoRegiao: null,
  diasAtendidos: [1, 2, 3, 4, 5, 6],
  horizonteDias: 14,
  antecedenciaMin: 120,
  remarcacoesMaxCliente: 2,
};

/** Quarta-feira, 10/09/2026, 07:00 em Natal (10:00 UTC). */
const QUARTA_7H = new Date("2026-09-10T10:00:00.000Z");
const QUARTA = "2026-09-10";

const ocupada = (n: number, naRegiao: number | null = null): Ocupacao => ({
  total: n,
  instalacao: n,
  reparo: 0,
  regiao: naRegiao,
});

describe("dia e turno no fuso do Brasil", () => {
  it("22h em Natal ainda e o mesmo dia, mesmo sendo o dia seguinte em UTC", () => {
    // 2026-09-10 22:00 BR = 2026-09-11 01:00 UTC. Ingenuidade aqui empurraria
    // toda OS do fim da noite pra agenda de amanha.
    expect(diaBrDe(new Date("2026-09-11T01:00:00.000Z"))).toBe("2026-09-10");
  });

  it("meio-dia e a virada entre manha e tarde", () => {
    expect(turnoBrDe(new Date("2026-09-10T14:59:00.000Z"))).toBe("manha"); // 11:59 BR
    expect(turnoBrDe(new Date("2026-09-10T15:00:00.000Z"))).toBe("tarde"); // 12:00 BR
  });

  it("somarDias atravessa a virada de mes sem mexer no fuso", () => {
    expect(somarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(diaDaSemana("2026-09-10")).toBe(4); // quinta
  });

  it("o turno da manha comeca as 8h de Natal (11h UTC)", () => {
    expect(inicioDoTurno(QUARTA, "manha").toISOString()).toBe("2026-09-10T11:00:00.000Z");
    expect(inicioDoTurno(QUARTA, "tarde").toISOString()).toBe("2026-09-10T16:00:00.000Z");
  });
});

describe("vagaDe", () => {
  it("turno vazio oferece a capacidade inteira", () => {
    const v = vagaDe({ dia: "2026-09-11", turno: "manha", config: CONFIG, agora: QUARTA_7H });
    expect(v).toMatchObject({ capacidade: 20, ocupadas: 0, livres: 20, bloqueio: null });
  });

  it("na vaga 19 ainda cabe uma; na 20 lota", () => {
    const quase = vagaDe({ dia: "2026-09-11", turno: "manha", config: CONFIG, ocupacao: ocupada(19), agora: QUARTA_7H });
    expect(quase).toMatchObject({ livres: 1, bloqueio: null });

    const cheia = vagaDe({ dia: "2026-09-11", turno: "manha", config: CONFIG, ocupacao: ocupada(20), agora: QUARTA_7H });
    expect(cheia).toMatchObject({ livres: 0, bloqueio: "lotado" });
  });

  it("domingo nao e ofertado nem com a agenda vazia", () => {
    // 2026-09-13 e domingo.
    expect(diaDaSemana("2026-09-13")).toBe(0);
    const v = vagaDe({ dia: "2026-09-13", turno: "manha", config: CONFIG, agora: QUARTA_7H });
    expect(v.bloqueio).toBe("dia_nao_atendido");
  });

  it("sabado: a manha oferece a capacidade inteira, a tarde nao existe", () => {
    // 2026-09-12 e sabado.
    expect(diaDaSemana("2026-09-12")).toBe(6);
    const manha = vagaDe({ dia: "2026-09-12", turno: "manha", config: CONFIG, agora: QUARTA_7H });
    expect(manha).toMatchObject({ livres: 20, bloqueio: null });

    const tarde = vagaDe({ dia: "2026-09-12", turno: "tarde", config: CONFIG, agora: QUARTA_7H });
    expect(tarde).toMatchObject({ livres: 0, bloqueio: "turno_nao_atendido" });
  });

  it("sabado a tarde nunca sai nas proximas vagas, mesmo com tudo vazio", () => {
    const vagas = proximasVagas({ config: CONFIG, agora: QUARTA_7H, ocupacoes: new Map(), quantas: 30 });
    expect(vagas.some((v) => diaDaSemana(v.dia) === 6 && v.turno === "tarde")).toBe(false);
    expect(vagas.some((v) => diaDaSemana(v.dia) === 6 && v.turno === "manha")).toBe(true);
  });

  it("dia nao atendido ganha do lotado — a recusa tem que explicar a causa certa", () => {
    const v = vagaDe({ dia: "2026-09-13", turno: "manha", config: CONFIG, ocupacao: ocupada(20), agora: QUARTA_7H });
    expect(v.bloqueio).toBe("dia_nao_atendido");
  });

  it("as 7h a manha de hoje ainda cabe; as 7h05 com 2h de antecedencia, nao", () => {
    // Manha comeca 8h. Faltando 60 min, a antecedencia de 120 min barra.
    const cedo = vagaDe({ dia: QUARTA, turno: "manha", config: CONFIG, agora: new Date("2026-09-10T08:30:00.000Z") });
    expect(cedo.bloqueio).toBeNull(); // 05:30 BR, faltam 2h30

    const emcima = vagaDe({ dia: QUARTA, turno: "manha", config: CONFIG, agora: QUARTA_7H });
    expect(emcima.bloqueio).toBe("antecedencia"); // 07:00 BR, falta 1h

    // A tarde do mesmo dia continua valendo.
    const tarde = vagaDe({ dia: QUARTA, turno: "tarde", config: CONFIG, agora: QUARTA_7H });
    expect(tarde.bloqueio).toBeNull();
  });

  it("teto regional barra com vaga global sobrando", () => {
    const config = { ...CONFIG, tetoRegiao: 5 };
    const v = vagaDe({
      dia: "2026-09-11",
      turno: "manha",
      config,
      ocupacao: ocupada(8, 5), // 8 no turno, 5 delas no mesmo bairro
      agora: QUARTA_7H,
    });
    expect(v.bloqueio).toBe("regiao");
    expect(v.ocupadas).toBe(8); // ainda ha 12 vagas no turno — so nao AQUI
  });

  it("sem regiao na consulta o teto regional nao opina", () => {
    const config = { ...CONFIG, tetoRegiao: 1 };
    const v = vagaDe({ dia: "2026-09-11", turno: "manha", config, ocupacao: ocupada(8), agora: QUARTA_7H });
    expect(v.bloqueio).toBeNull();
  });
});

describe("proximasVagas — o que o cliente chega a ouvir", () => {
  it("dia cheio some da oferta e a proxima data assume", () => {
    const ocupacoes = new Map<string, Ocupacao>([
      [chaveJanela("2026-09-11", "manha"), ocupada(20)],
      [chaveJanela("2026-09-11", "tarde"), ocupada(20)],
    ]);
    const vagas = proximasVagas({ agora: QUARTA_7H, config: CONFIG, ocupacoes, quantas: 3 });

    // 10/09 manha caiu por antecedencia; 10/09 tarde vale; 11/09 lotou os dois;
    // 12/09 (sabado) so tem a manha. 13/09 e domingo e nao entra; 14/09 assume.
    expect(vagas.map((v) => `${v.dia} ${v.turno}`)).toEqual([
      "2026-09-10 tarde",
      "2026-09-12 manha",
      "2026-09-14 manha",
    ]);
  });

  it("nunca devolve janela bloqueada — e o contrato inteiro desta funcao", () => {
    const vagas = proximasVagas({ agora: QUARTA_7H, config: CONFIG, ocupacoes: new Map(), quantas: 50 });
    expect(vagas.every((v) => v.bloqueio === null && v.livres > 0)).toBe(true);
    expect(vagas.some((v) => diaDaSemana(v.dia) === 0)).toBe(false);
  });
});

describe("montarGrade — a aba Painel da planilha", () => {
  it("cobre o intervalo inteiro com dois turnos por dia", () => {
    const grade = montarGrade({
      de: "2026-09-10",
      ate: "2026-09-12",
      config: CONFIG,
      ocupacoes: new Map(),
      agora: QUARTA_7H,
    });
    expect(grade).toHaveLength(6);
    expect(grade[0]).toMatchObject({ dia: "2026-09-10", turno: "manha" });
    expect(grade[5]).toMatchObject({ dia: "2026-09-12", turno: "tarde" });
  });

  it("separa instalacao de reparo mas soma no mesmo teto", () => {
    const ocupacoes = new Map<string, Ocupacao>([
      [chaveJanela("2026-09-11", "manha"), { total: 20, instalacao: 12, reparo: 8, regiao: null }],
    ]);
    const [manha] = montarGrade({
      de: "2026-09-11",
      ate: "2026-09-11",
      config: CONFIG,
      ocupacoes,
      agora: QUARTA_7H,
    });
    // Os tecnicos atendem os dois tipos — 12+8 lota o turno, como na planilha.
    expect(manha).toMatchObject({ instalacao: 12, reparo: 8, ocupadas: 20, bloqueio: "lotado" });
  });
});

describe("teto do DIA — o outro limite", () => {
  const COM_TETO_DIA = { ...CONFIG, vagasDia: 30 };

  it("dia cheio bloqueia os DOIS turnos, mesmo com turno vazio", () => {
    // 30 de 30 no dia, todas na manhã: a tarde está vazia e mesmo assim fecha.
    const v = vagaDe({
      dia: "2026-09-11",
      turno: "tarde",
      config: COM_TETO_DIA,
      ocupacao: ocupada(0),
      ocupadasDia: 30,
      agora: QUARTA_7H,
    });
    expect(v.bloqueio).toBe("dia_lotado");
  });

  it("'dia lotado' ganha de 'lotado' — a recusa tem que mandar trocar de DATA", () => {
    // Dizer "turno lotado" mandaria a atendente tentar o outro turno do mesmo
    // dia, que também não tem.
    const v = vagaDe({
      dia: "2026-09-11",
      turno: "manha",
      config: COM_TETO_DIA,
      ocupacao: ocupada(20),
      ocupadasDia: 30,
      agora: QUARTA_7H,
    });
    expect(v.bloqueio).toBe("dia_lotado");
  });

  it("as vagas anunciadas são o MENOR dos dois limites", () => {
    /*
     * 28 de 30 no dia, manhã vazia. Sem cruzar os limites a tela anunciaria
     * "20 livres" e a 3ª marcação seria recusada depois de a atendente já ter
     * oferecido as vinte.
     */
    const v = vagaDe({
      dia: "2026-09-11",
      turno: "manha",
      config: COM_TETO_DIA,
      ocupacao: ocupada(0),
      ocupadasDia: 28,
      agora: QUARTA_7H,
    });
    expect(v).toMatchObject({ livres: 2, bloqueio: null });
  });

  it("sem teto diário nada muda — o limite do dia vira a soma dos turnos", () => {
    const v = vagaDe({
      dia: "2026-09-11",
      turno: "manha",
      config: CONFIG,
      ocupacao: ocupada(0),
      ocupadasDia: 999,
      agora: QUARTA_7H,
    });
    expect(v).toMatchObject({ livres: 20, bloqueio: null });
  });

  it("montarGrade soma os dois turnos do dia sozinha", () => {
    const ocupacoes = new Map<string, Ocupacao>([
      [chaveJanela("2026-09-11", "manha"), ocupada(16)],
      [chaveJanela("2026-09-11", "tarde"), ocupada(14)],
    ]);
    const grade = montarGrade({
      de: "2026-09-11",
      ate: "2026-09-11",
      config: COM_TETO_DIA,
      ocupacoes,
      agora: QUARTA_7H,
    });
    // 16+14 = 30 = o teto. Nenhum dos dois turnos está cheio sozinho.
    expect(grade.map((v) => v.bloqueio)).toEqual(["dia_lotado", "dia_lotado"]);
    expect(grade[0]!.ocupadasDia).toBe(30);
  });

  it("proximasVagas pula o dia cheio e vai pro seguinte", () => {
    const ocupacoes = new Map<string, Ocupacao>([
      [chaveJanela("2026-09-11", "manha"), ocupada(30)],
    ]);
    const vagas = proximasVagas({ agora: QUARTA_7H, config: COM_TETO_DIA, ocupacoes, quantas: 2 });
    expect(vagas.some((v) => v.dia === "2026-09-11")).toBe(false);
  });
});

describe("feriados e exceções de calendário", () => {
  const excecao = (dia: string, atende: boolean, motivo: string): Map<string, ExcecaoAgendaDto> =>
    new Map([[dia, { dia, atende, motivo }]]);

  it("Natal fecha mesmo caindo em dia útil e com a agenda vazia", () => {
    // 2026-12-25 é sexta — um dia atendido, sem nenhuma marcação.
    expect(diaDaSemana("2026-12-25")).toBe(5);
    const v = vagaDe({ dia: "2026-12-25", turno: "manha", config: CONFIG, agora: QUARTA_7H });
    expect(v).toMatchObject({ bloqueio: "feriado", motivoBloqueio: "Natal", livres: 0 });
  });

  it("o motivo chega na grade — dia que some sem explicação vira chamado interno", () => {
    const [manha] = montarGrade({
      de: "2026-06-04", // Corpus Christi de 2026
      ate: "2026-06-04",
      config: CONFIG,
      ocupacoes: new Map(),
      agora: QUARTA_7H,
    });
    expect(manha!.motivoBloqueio).toBe("Corpus Christi");
  });

  it("exceção cadastrada fecha um dia útil comum", () => {
    const v = vagaDe({
      dia: "2026-09-11",
      turno: "manha",
      config: CONFIG,
      excecao: excecao("2026-09-11", false, "Padroeira da cidade").get("2026-09-11"),
      agora: QUARTA_7H,
    });
    expect(v).toMatchObject({ bloqueio: "feriado", motivoBloqueio: "Padroeira da cidade" });
  });

  it("exceção com atende:true ABRE um domingo", () => {
    // 2026-09-13 é domingo, que `diasAtendidos` não cobre.
    const v = vagaDe({
      dia: "2026-09-13",
      turno: "manha",
      config: CONFIG,
      excecao: excecao("2026-09-13", true, "Mutirão").get("2026-09-13"),
      agora: QUARTA_7H,
    });
    expect(v).toMatchObject({ bloqueio: null, livres: 20 });
  });

  it("mutirao cadastrado com `atende: true` abre tambem a tarde de sabado", () => {
    const v = vagaDe({
      dia: "2026-09-12",
      turno: "tarde",
      config: CONFIG,
      agora: QUARTA_7H,
      excecao: excecao("2026-09-12", true, "Mutirão").get("2026-09-12"),
    });
    expect(v.bloqueio).toBeNull();
  });

  it("exceção com atende:true ganha até do feriado nacional", () => {
    /*
     * É o override humano: quem cadastrou sabe que a equipe vai trabalhar
     * naquele feriado, e nenhuma regra automática deve poder desfazer isso.
     */
    const v = vagaDe({
      dia: "2026-12-25",
      turno: "manha",
      config: CONFIG,
      excecao: excecao("2026-12-25", true, "Plantão de Natal").get("2026-12-25"),
      agora: QUARTA_7H,
    });
    expect(v.bloqueio).toBeNull();
  });

  it("mesmo liberado na mão, o turno lotado continua lotado", () => {
    // A exceção decide o CALENDÁRIO, não a capacidade da equipe.
    const v = vagaDe({
      dia: "2026-12-25",
      turno: "manha",
      config: CONFIG,
      ocupacao: ocupada(20),
      excecao: excecao("2026-12-25", true, "Plantão").get("2026-12-25"),
      agora: QUARTA_7H,
    });
    expect(v.bloqueio).toBe("lotado");
  });

  it("proximasVagas nunca oferece um feriado", () => {
    const vagas = proximasVagas({
      agora: new Date("2026-12-22T10:00:00.000Z"),
      config: { ...CONFIG, horizonteDias: 10 },
      ocupacoes: new Map(),
      quantas: 40,
    });
    expect(vagas.some((v) => v.dia === "2026-12-25")).toBe(false);
    // E os dias em volta continuam sendo oferecidos.
    expect(vagas.some((v) => v.dia === "2026-12-24")).toBe(true);
  });
});

describe("podeClienteRemarcar — as regras do autoatendimento", () => {
  const base = { hoje: "2026-09-10", max: 2 };

  it("primeira remarcação, visita amanhã: pode", () => {
    expect(podeClienteRemarcar({ ...base, atual: { dia: "2026-09-11", remarcacoesCliente: 0 } })).toBeNull();
  });

  it("na segunda ainda pode; na terceira, não", () => {
    expect(podeClienteRemarcar({ ...base, atual: { dia: "2026-09-11", remarcacoesCliente: 1 } })).toBeNull();
    const r = podeClienteRemarcar({ ...base, atual: { dia: "2026-09-11", remarcacoesCliente: 2 } });
    expect(r?.motivo).toBe("max_remarcacoes");
  });

  it("no DIA da visita não remarca mais — o técnico já saiu com a rota", () => {
    const r = podeClienteRemarcar({ ...base, atual: { dia: "2026-09-10", remarcacoesCliente: 0 } });
    expect(r?.motivo).toBe("tarde_demais");
  });

  it("visita que já passou também é tarde demais", () => {
    const r = podeClienteRemarcar({ ...base, atual: { dia: "2026-09-08", remarcacoesCliente: 0 } });
    expect(r?.motivo).toBe("tarde_demais");
  });

  it("sem visita marcada, a recusa diz isso — não 'você já remarcou demais'", () => {
    // A explicação errada faria o cliente discutir um limite que ele não usou.
    expect(podeClienteRemarcar({ ...base, atual: null })?.motivo).toBe("sem_marcacao");
  });

  it("o teto vem da configuração, não do código", () => {
    expect(podeClienteRemarcar({ ...base, max: 5, atual: { dia: "2026-09-11", remarcacoesCliente: 3 } })).toBeNull();
    expect(podeClienteRemarcar({ ...base, max: 0, atual: { dia: "2026-09-11", remarcacoesCliente: 0 } })?.motivo).toBe(
      "max_remarcacoes",
    );
  });

  it("a recusa é 409 — é regra de negócio, não erro do sistema", () => {
    expect(podeClienteRemarcar({ ...base, atual: null })?.status).toBe(409);
  });
});

describe("resumirMarcacoes — quem esta marcando", () => {
  it("soma por funcionario, separa cancelada de marcada e ordena pelo que esta de pe", () => {
    const r = resumirMarcacoes([
      { marcadoPor: "maria@isp.com", origem: "isphub", status: "marcado", total: 7 },
      { marcadoPor: "maria@isp.com", origem: "isphub", status: "cancelado", total: 2 },
      { marcadoPor: "joao@isp.com", origem: "isphub", status: "marcado", total: 9 },
      { marcadoPor: null, origem: "atendai_ia", status: "marcado", total: 4 },
    ]);
    expect(r.map((x) => [x.marcadoPor, x.marcadas, x.canceladas])).toEqual([
      ["joao@isp.com", 9, 0],
      ["maria@isp.com", 7, 2],
      ["atendai_ia", 4, 0],
    ]);
  });

  it("sem nome, a origem responde — o bot aparece como 'atendai_ia', nao como vazio", () => {
    const [bot] = resumirMarcacoes([{ marcadoPor: "  ", origem: "atendai_ia", status: "marcado", total: 1 }]);
    expect(bot.marcadoPor).toBe("atendai_ia");
  });
});
