import {
  classeDaOs,
  dataDoDia,
  janelaDeVaga,
  ORIGEM_AUTO,
  proporAgenda,
  somarDias,
  TURNOS_AGENDA,
  chaveDeDuplicada,
  type CandidataAuto,
  type JanelaPool,
  type ResultadoAuto,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import * as agenda from "./agendaService.js";
import { calcularSla } from "./slaService.js";
import { provedoresComOferta } from "./ofertaAgendaService.js";

/**
 * Proposta de agenda automatica: le o banco, delega a decisao ao motor puro
 * (`shared/autoAgenda.ts`) e devolve. NAO grava e NAO atribui tecnico.
 */

/** OS abertas/pendentes sem visita marcada, no formato do motor. */
async function candidatas(): Promise<CandidataAuto[]> {
  // Com o robo de agendamento ligado, quem escolhe a data das OS agendaveis e
  // o CLIENTE: o agendador nao pode marcar por cima.
  const comOferta = (await provedoresComOferta()).map((p) => p.provedorId);
  const [oss, marcadas] = await Promise.all([
    prisma.ordemServico.findMany({
      where: {
        status: { in: ["aberta", "pendente"] },
        NOT: { provedorId: { in: comOferta }, tipoOs: { agendavel: true } },
      },
      select: {
        provedorId: true,
        sgpOsId: true,
        clienteNome: true,
        contratoId: true,
        prioridade: true,
        dataCadastro: true,
        criadoEm: true,
        contratoStatus: true,
        pop: true,
        bairro: true,
        tipoOs: {
          select: {
            descricao: true,
            slaHoras: true,
            categoria: { select: { nome: true, equipeExterna: true, slaHorasPadrao: true } },
          },
        },
      },
    }),
    // Por (provedor, sgpOsId) e nao pela relacao: marcacao orfa (OS ainda nao
    // espelhada) tambem consome a OS.
    prisma.agendamento.findMany({
      where: { status: "marcado" },
      select: {
        provedorId: true,
        sgpOsId: true,
        ordemServico: { select: { contratoId: true, tipoOs: { select: { descricao: true } } } },
      },
    }),
  ]);
  // Contrato+tipo que ja tem visita: outra OS igual e duplicata, nao outra visita.
  const chavesMarcadas = new Set(
    marcadas
      .map((m) => chaveDeDuplicada(m.provedorId, m.ordemServico?.contratoId, m.ordemServico?.tipoOs?.descricao ?? null))
      .filter((k): k is string => k != null),
  );
  const jaMarcada = new Set(marcadas.map((m) => `${m.provedorId}|${m.sgpOsId}`));
  const agora = new Date();

  return oss
    .filter((o) => !jaMarcada.has(`${o.provedorId}|${o.sgpOsId}`))
    .map((o) => ({
      provedorId: o.provedorId,
      sgpOsId: o.sgpOsId,
      clienteNome: o.clienteNome,
      contratoId: o.contratoId,
      duplicaMarcada: chavesMarcadas.has(
        chaveDeDuplicada(o.provedorId, o.contratoId, o.tipoOs?.descricao ?? null) ?? "",
      ),
      categoria: o.tipoOs?.categoria?.nome ?? null,
      equipeExterna: o.tipoOs?.categoria?.equipeExterna ?? false,
      tipo: o.tipoOs?.descricao ?? null,
      prioridade: o.prioridade,
      slaEstourado:
        calcularSla({
          slaHoras: o.tipoOs?.slaHoras ?? o.tipoOs?.categoria?.slaHorasPadrao,
          dataBase: o.dataCadastro ?? o.criadoEm,
          agora,
        }).semaforo === "vermelho",
      dataCadastro: o.dataCadastro,
      contratoStatus: o.contratoStatus,
      regiao: o.pop ?? o.bairro ?? null,
    }));
}

export async function proporAgendaDoBanco(agora = new Date()): Promise<ResultadoAuto> {
  const [lista, config] = await Promise.all([candidatas(), agenda.lerConfig()]);
  const de = agenda.diaBrDe(agora);
  const ate = somarDias(de, config.horizonteDias);
  // Capacidade e global (todos os provedores juntos), lida sempre do AgendaConfig vigente.
  const [gradeCompleta, ocupacoes] = await Promise.all([
    agenda.grade({ de, ate, agora }),
    agenda.ocupacoesEntre(de, ate),
  ]);

  // O que cada dia comporta: `vagasDia`, ou a soma dos turnos que atendem.
  const ATENDE = (b: string | null) => !["feriado", "dia_nao_atendido", "turno_nao_atendido", "sem_equipe"].includes(b ?? "");
  const tetoDoDia = new Map<string, number>();
  for (const v of gradeCompleta) if (ATENDE(v.bloqueio)) tetoDoDia.set(v.dia, (tetoDoDia.get(v.dia) ?? 0) + v.capacidade);
  const teto = (dia: string) => Math.min(config.vagasDia ?? Infinity, tetoDoDia.get(dia) ?? 0);

  // Reserva pra "sem conexao": guardada nos dias alem de amanha, liberada na
  // vespera pra nao deixar vaga ociosa. Ja descontadas as urgentes marcadas.
  const amanha = somarDias(de, 1);
  const urgentesNoDia = await urgentesMarcadas(de, ate);
  const reservaUrgencia = (dia: string) =>
    dia <= amanha ? 0 : Math.max(0, (config.vagasUrgenciaDia ?? 0) - (urgentesNoDia.get(dia) ?? 0));

  // Fatia da retirada ainda por preencher no dia: reservada, a fila normal nao a toca.
  const fatia = config.vagasRetiradaDia ?? 0;
  const reserva = (dia: string) =>
    Math.max(0, fatia - TURNOS_AGENDA.reduce((n, t) => n + (ocupacoes.get(agenda.chaveJanela(dia, t))?.retirada ?? 0), 0));

  // Uma consulta por regiao, porque `ocupadasRegiao` e o teto regional dependem
  // dela. Sao poucas (POPs), nao uma por OS. A retirada usa a regiao "" (sem teto regional).
  const regioes = new Set(lista.map((c) => c.regiao ?? ""));
  regioes.add("");
  const normal = new Map<string, JanelaPool[]>();
  const retirada = new Map<string, JanelaPool[]>();
  for (const r of regioes) {
    const vagas = await agenda.proximasVagasDoBanco({ regiao: r || null, quantas: 200, agora });
    normal.set(
      r,
      vagas.map((v) => ({ ...janelaDeVaga(v, teto(v.dia), reserva(v.dia)), reservaUrgencia: reservaUrgencia(v.dia) })),
    );
    if (r === "") {
      const livres = vagas.map((v) => janelaDeVaga(v, teto(v.dia), 0));
      for (const x of regioes) retirada.set(x, livres);
    }
  }

  return proporAgenda({ candidatas: lista, normal, retirada, tetoRegiao: config.tetoRegiao });
}

/** Quantas visitas "sem conexao" ja estao marcadas em cada dia — encolhem a reserva. */
async function urgentesMarcadas(de: string, ate: string): Promise<Map<string, number>> {
  const linhas = await prisma.agendamento.findMany({
    where: { status: "marcado", fila: "normal", dia: { gte: dataDoDia(de), lte: dataDoDia(ate) } },
    select: {
      dia: true,
      ordemServico: { select: { tipoOs: { select: { descricao: true, categoria: { select: { nome: true } } } } } },
    },
  });
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    const tipo = l.ordemServico?.tipoOs;
    if (!tipo || classeDaOs({ tipo: tipo.descricao, categoria: tipo.categoria?.nome ?? null }) !== 0) continue;
    const dia = l.dia.toISOString().slice(0, 10);
    mapa.set(dia, (mapa.get(dia) ?? 0) + 1);
  }
  return mapa;
}

export interface PropostaParaAplicar {
  provedorId: string;
  sgpOsId: string;
  dia: string;
  turno: "manha" | "tarde";
  regiao?: string | null;
  fila?: "normal" | "retirada";
}

export interface ResultadoAplicacao {
  aplicadas: { provedorId: string; sgpOsId: string; dia: string; turno: string }[];
  recusadas: { provedorId: string; sgpOsId: string; motivo: string }[];
}

/**
 * Grava propostas, UMA a UMA, pelo mesmo `marcar()` de todo mundo — entao o
 * advisory lock, o teto do turno/dia/regiao e o feriado valem de novo na hora
 * de gravar. Proposta e foto de um instante; ate aqui a vaga pode ter ido.
 *
 * Recusar e resposta, nao falha: a OS que nao coube segue na fila. So um erro
 * que NAO e de regra (banco fora, por exemplo) interrompe.
 */
export async function aplicarPropostas(
  propostas: PropostaParaAplicar[],
  marcadoPor: string,
): Promise<ResultadoAplicacao> {
  const resultado: ResultadoAplicacao = { aplicadas: [], recusadas: [] };
  for (const p of propostas) {
    const id = { provedorId: p.provedorId, sgpOsId: p.sgpOsId };
    // Marcar de novo sobrescreveria visita que alguem combinou com o cliente
    // depois da proposta; e a OS pode ter fechado nesse meio tempo.
    const [ja, os] = await Promise.all([
      prisma.agendamento.findUnique({ where: { provedorId_sgpOsId: id }, select: { status: true } }),
      prisma.ordemServico.findUnique({ where: { provedorId_sgpOsId: id }, select: { status: true } }),
    ]);
    if (ja?.status === "marcado") {
      resultado.recusadas.push({ ...id, motivo: "Já tem visita marcada." });
      continue;
    }
    if (os && !["aberta", "pendente"].includes(os.status)) {
      resultado.recusadas.push({ ...id, motivo: `OS já está ${os.status}.` });
      continue;
    }
    try {
      const m = await agenda.marcar({
        ...id,
        dia: p.dia,
        turno: p.turno,
        regiao: p.regiao ?? null,
        origem: ORIGEM_AUTO,
        marcadoPor,
        fila: p.fila ?? "normal",
      });
      void agenda.enviarAoSgp(m.id);
      resultado.aplicadas.push({ ...id, dia: p.dia, turno: p.turno });
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) resultado.recusadas.push({ ...id, motivo: e.message });
      else throw e;
    }
  }
  return resultado;
}

export interface RodadaAuto {
  quando: Date;
  ativa: boolean;
  marcadas: number;
  recusadas: number;
  erro: string | null;
}

let ultimaRodada: RodadaAuto | null = null;
export const ultimaRodadaAuto = () => ultimaRodada;
let rodando = false;

/**
 * Uma rodada do job. Marca SO a fila normal (instalacao e reparo): a retirada,
 * que e o backlog, so sai por lote aprovado pelo supervisor. Roda com tudo
 * desligado por padrao e para no teto `autoAgendaMaxRodada`.
 *
 * ponytail: um processo so (flag em memoria). Duas instancias da API rodariam a
 * rodada em dobro — `marcar()` segura o excesso, mas passa a valer um lock.
 */
export async function rodarAuto(agora = new Date()): Promise<RodadaAuto> {
  const base: RodadaAuto = { quando: agora, ativa: false, marcadas: 0, recusadas: 0, erro: null };
  if (rodando) return base;
  rodando = true;
  try {
    const config = await agenda.lerConfig();
    if (!config.autoAgendaAtiva) return (ultimaRodada = base);
    const r = await proporAgendaDoBanco(agora);
    const propostas = r.propostas.filter((p) => p.fila === "normal").slice(0, config.autoAgendaMaxRodada ?? 20);
    const feito = await aplicarPropostas(propostas, ORIGEM_AUTO);
    return (ultimaRodada = {
      ...base,
      ativa: true,
      marcadas: feito.aplicadas.length,
      recusadas: feito.recusadas.length,
    });
  } catch (e) {
    return (ultimaRodada = { ...base, ativa: true, erro: e instanceof Error ? e.message : String(e) });
  } finally {
    rodando = false;
  }
}

/**
 * Desfaz o que o agendador marcou desde `desde` (padrao: hoje, hora de Brasilia).
 * Pula a visita que o CLIENTE ja confirmou — desmarcar essa quebraria algo que
 * ele combinou. A data no SGP e limpa pelo mesmo caminho do cancelamento manual.
 */
export async function desfazerLoteAuto(desde?: Date) {
  const inicio = desde ?? new Date(dataDoDia(agenda.diaBrDe(new Date())).getTime() + 3 * 3_600_000);
  const marcas = await prisma.agendamento.findMany({
    where: { origem: ORIGEM_AUTO, status: "marcado", criadoEm: { gte: inicio } },
    select: { id: true, confirmadoEm: true },
  });
  let desfeitas = 0;
  let mantidas = 0;
  for (const m of marcas) {
    if (m.confirmadoEm) {
      mantidas++;
      continue;
    }
    await agenda.cancelar(m.id);
    void agenda.limparNoSgp(m.id);
    desfeitas++;
  }
  return { desfeitas, mantidasConfirmadas: mantidas };
}

/** O que o supervisor precisa ver pra confiar (ou desconfiar) do agendador. */
export async function saudeDoAgendador(agora = new Date()) {
  const [config, proposta] = await Promise.all([agenda.lerConfig(), proporAgendaDoBanco(agora)]);
  const hoje = agenda.diaBrDe(agora);
  const amanha = somarDias(hoje, 1);
  const limiteSemData = new Date(agora.getTime() - 7 * 86_400_000);
  const quinzeMin = new Date(agora.getTime() - 15 * 60_000);

  const [grade, pendenteSgp, semConfirmacaoAmanha, semDataHaMuito] = await Promise.all([
    agenda.grade({ de: amanha, ate: amanha, agora }),
    prisma.agendamento.count({ where: { status: "marcado", sgpConfirmadoEm: null, criadoEm: { lt: quinzeMin } } }),
    prisma.agendamento.count({ where: { status: "marcado", dia: dataDoDia(amanha), confirmadoEm: null } }),
    prisma.ordemServico.count({
      where: { status: { in: ["aberta", "pendente"] }, dataCadastro: { lt: limiteSemData } },
    }),
  ]);
  const rodada = ultimaRodada;
  return {
    ativa: config.autoAgendaAtiva ?? false,
    ultimaRodada: rodada,
    // Ligado e sem rodar ha mais de 30 min = o job parou (rodada a cada 10).
    rodadaAtrasada: !!config.autoAgendaAtiva && (!rodada || agora.getTime() - rodada.quando.getTime() > 30 * 60_000),
    vagasOciosasAmanha: grade.reduce((n, v) => n + Math.max(0, v.livres ?? 0), 0),
    pendentesNoSgp: pendenteSgp,
    semConfirmacaoAmanha,
    osAbertasHaMaisDe7Dias: semDataHaMuito,
    propostasPendentes: proposta.propostas.length,
    emRevisao: proposta.revisao.length,
    semVaga: proposta.semVaga.length,
  };
}
