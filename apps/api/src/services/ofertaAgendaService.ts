import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { AtendaiIndisponivel, chamar, credencialDoProvedor } from "./atendaiService.js";
import { telefoneDaOs } from "./clienteAtendaiService.js";
import * as agenda from "./agendaService.js";

/**
 * Robo de agendamento: OS de tipo `agendavel`, aberta e sem visita, recebe as
 * datas livres no WhatsApp do cliente (pelo AtendAI do provedor) e o CLIENTE
 * escolhe — quem abriu a OS nao agenda. A escolha volta pelo `/marcar` da API
 * de parceiro, igual a qualquer outra marcacao.
 *
 * Aqui so se decide QUEM recebe e QUANDO, e se guarda o estado. Falar com o
 * cliente e interpretar a resposta e trabalho do AtendAI.
 *
 * Regras fixas (decisao do Clebson: regra de operacao no codigo, nao em tela).
 */
export const MAX_TENTATIVAS = 3;
export const INTERVALO_MS = 24 * 3_600_000;
/** Hora de Brasilia em que pode sair mensagem: 07h ate antes das 20h. */
export const JANELA_HORAS = { de: 7, ate: 20 } as const;
export const MAX_POR_RODADA = 20;

export interface OsCandidata {
  provedorId: string;
  sgpOsId: string;
  telefone: string | null;
  /** Ja tem visita marcada (por qualquer caminho). */
  marcada: boolean;
}

export interface OfertaExistente {
  provedorId: string;
  sgpOsId: string;
  tentativas: number;
  ultimaEm: Date | null;
  status: string;
}

export interface Decisao {
  enviar: OsCandidata[];
  semRetorno: OfertaExistente[];
  agendadas: OfertaExistente[];
}

export function dentroDaJanela(agora: Date): boolean {
  const horaBr = (agora.getUTCHours() + 21) % 24;
  return horaBr >= JANELA_HORAS.de && horaBr < JANELA_HORAS.ate;
}

const chave = (x: { provedorId: string; sgpOsId: string }) => `${x.provedorId}|${x.sgpOsId}`;

/**
 * A decisao, sem banco. Sem resposta e o teto batido so vira `sem_retorno`
 * depois do intervalo do ULTIMO envio — senao o terceiro envio e a desistencia
 * sairiam juntos e o cliente nunca teria tempo de responder a ultima.
 */
export function decidir(oss: OsCandidata[], ofertas: OfertaExistente[], agora: Date): Decisao {
  const porOs = new Map(ofertas.map((o) => [chave(o), o]));
  const d: Decisao = { enviar: [], semRetorno: [], agendadas: [] };
  for (const os of oss) {
    const of = porOs.get(chave(os));
    if (os.marcada) {
      if (of && of.status !== "agendada") d.agendadas.push(of);
      continue;
    }
    if (of?.status === "sem_retorno" || of?.status === "agendada") continue;
    const esperou = !of?.ultimaEm || agora.getTime() - of.ultimaEm.getTime() >= INTERVALO_MS;
    if (!esperou) continue;
    if (of && of.tentativas >= MAX_TENTATIVAS) {
      d.semRetorno.push(of);
      continue;
    }
    if (!telefoneDaOs(os.telefone)) continue;
    if (d.enviar.length < MAX_POR_RODADA) d.enviar.push(os);
  }
  return d;
}

/**
 * Contrato com o AtendAI: `POST /api/externo/v1/isphub/oferta-agenda`.
 * `SEM_VAGA` = nao ha data livre pra oferecer; nao gasta tentativa do cliente.
 */
export interface RespostaOferta {
  status: "ENVIADO" | "ENVIADO_TEMPLATE" | "SEM_VAGA" | "FORA_DA_JANELA" | "FALHA";
  erro?: string;
}

export interface RodadaOferta {
  enviadas: number;
  falhas: number;
  semRetorno: number;
  agendadas: number;
  erro: string | null;
}

let rodando = false;

/** Provedores com o robo ligado — e com o AtendAI ativo, sem o qual nao ha por onde falar. */
export async function provedoresComOferta(): Promise<{ provedorId: string }[]> {
  return prisma.atendaiConfig.findMany({
    where: { ofertaAgendaAtiva: true, ativo: true },
    select: { provedorId: true },
  });
}

/**
 * Uma rodada do job.
 *
 * ponytail: um processo so (flag em memoria), mesmo limite do `rodarAuto`.
 */
export async function rodarOferta(agora = new Date()): Promise<RodadaOferta> {
  const r: RodadaOferta = { enviadas: 0, falhas: 0, semRetorno: 0, agendadas: 0, erro: null };
  if (rodando || !dentroDaJanela(agora)) return r;
  rodando = true;
  try {
    const provs = await provedoresComOferta();
    if (provs.length === 0) return r;
    const ids = provs.map((p) => p.provedorId);

    const [oss, marcadas, ofertas] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { provedorId: { in: ids }, status: { in: ["aberta", "pendente"] }, tipoOs: { agendavel: true } },
        select: {
          id: true,
          provedorId: true,
          sgpOsId: true,
          telefone: true,
          clienteNome: true,
          pop: true,
          bairro: true,
          tipoOs: { select: { descricao: true } },
        },
      }),
      prisma.agendamento.findMany({
        where: { provedorId: { in: ids }, status: "marcado" },
        select: { provedorId: true, sgpOsId: true },
      }),
      prisma.ofertaAgenda.findMany({ where: { provedorId: { in: ids } } }),
    ]);
    const jaMarcada = new Set(marcadas.map(chave));
    const dados = new Map(oss.map((o) => [chave(o), o]));
    const d = decidir(
      oss.map((o) => ({ provedorId: o.provedorId, sgpOsId: o.sgpOsId, telefone: o.telefone, marcada: jaMarcada.has(chave(o)) })),
      ofertas,
      agora,
    );

    for (const of of d.agendadas) {
      await prisma.ofertaAgenda.update({ where: { provedorId_sgpOsId: { provedorId: of.provedorId, sgpOsId: of.sgpOsId } }, data: { status: "agendada" } });
      r.agendadas++;
    }

    for (const of of d.semRetorno) {
      const id = { provedorId: of.provedorId, sgpOsId: of.sgpOsId };
      await prisma.$transaction(async (tx) => {
        await tx.ofertaAgenda.update({ where: { provedorId_sgpOsId: id }, data: { status: "sem_retorno" } });
        await agenda.registrarEvento(tx, { ...id, tipo: "oferta_sem_retorno", origem: "auto", autor: "Robô de agendamento" });
      });
      await avisarSemRetorno(of.provedorId, of.sgpOsId, dados.get(chave(of)) ?? null);
      r.semRetorno++;
    }

    const credPorProvedor = new Map<string, Awaited<ReturnType<typeof credencialDoProvedor>>>();
    for (const os of d.enviar) {
      const o = dados.get(chave(os))!;
      if (!credPorProvedor.has(os.provedorId)) credPorProvedor.set(os.provedorId, await credencialDoProvedor(os.provedorId));
      const cred = credPorProvedor.get(os.provedorId);
      if (!cred) continue;

      let resp: RespostaOferta;
      try {
        resp = await chamar<RespostaOferta>(cred, "POST", "/isphub/oferta-agenda", {
          sgpOsId: os.sgpOsId,
          telefone: telefoneDaOs(o.telefone),
          nome: o.clienteNome,
          tipo: o.tipoOs?.descricao ?? null,
          regiao: o.pop ?? o.bairro ?? null,
        });
      } catch (e) {
        // AtendAI fora (rede, 5xx, chave): NAO gasta tentativa do cliente — senao
        // uma queda de horas mandaria todo mundo pra "sem retorno". Para a rodada.
        // Recusa do proprio pedido (400/422: telefone, OS) conta; chave errada
        // (401/403) ou rota inexistente (404, AtendAI sem a versao nova) para.
        if (e instanceof AtendaiIndisponivel && e.status < 500 && ![401, 403, 404].includes(e.status)) {
          await registrarEnvio(os, false, e.message);
          r.falhas++;
          continue;
        }
        r.erro = e instanceof Error ? e.message : String(e);
        break;
      }
      // Agenda lotada no horizonte: ninguem tem o que receber agora. Tenta na proxima rodada.
      if (resp.status === "SEM_VAGA") break;
      const saiu = resp.status === "ENVIADO" || resp.status === "ENVIADO_TEMPLATE";
      // Nao saiu (numero sem WhatsApp, sem modelo aprovado): conta a tentativa
      // mesmo assim, pra que no teto a OS caia pra uma pessoa em vez de girar.
      await registrarEnvio(os, saiu, saiu ? null : (resp.erro ?? resp.status));
      if (saiu) r.enviadas++;
      else r.falhas++;
    }
    return r;
  } catch (e) {
    return { ...r, erro: e instanceof Error ? e.message : String(e) };
  } finally {
    rodando = false;
  }
}

async function registrarEnvio(os: { provedorId: string; sgpOsId: string }, saiu: boolean, erro: string | null) {
  const id = { provedorId: os.provedorId, sgpOsId: os.sgpOsId };
  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.ofertaAgenda.upsert({
      where: { provedorId_sgpOsId: id },
      create: { ...id, tentativas: 1, ultimaEm: agora, status: "enviada", ultimoErro: erro },
      update: { tentativas: { increment: 1 }, ultimaEm: agora, ultimoErro: erro },
    });
    if (saiu) await agenda.registrarEvento(tx, { ...id, tipo: "oferta_enviada", origem: "auto", autor: "Robô de agendamento" });
  });
}

/** Sem retorno vira trabalho de gente: avisa gestao e as atendentes do provedor. */
async function avisarSemRetorno(provedorId: string, sgpOsId: string, os: { id: string; clienteNome: string | null } | null) {
  const cliente = os?.clienteNome ?? null;
  const pessoas = await prisma.usuario.findMany({
    where: {
      ativo: true,
      OR: [{ role: { in: [UserRole.ADMIN, UserRole.GESTOR] } }, { role: UserRole.ATENDENTE, provedorId }],
    },
    select: { id: true },
  });
  if (pessoas.length === 0) return;
  await prisma.notificacao.createMany({
    data: pessoas.map((p) => ({
      usuarioId: p.id,
      tipo: "agenda_sem_retorno",
      ordemServicoId: os?.id ?? null,
      mensagem: `OS ${sgpOsId}${cliente ? ` (${cliente})` : ""}: o cliente não respondeu às ${MAX_TENTATIVAS} mensagens do robô de agendamento. Agende por contato humano.`,
    })),
  });
}
