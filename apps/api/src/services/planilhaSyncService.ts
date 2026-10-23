import { createHash } from "node:crypto";
import {
  OBSERVACAO_PLANILHA,
  ORIGEM_PLANILHA,
  UserRole,
  consolidarLinhas,
  decidirLinha,
  diaDaCelula,
  osDaCelula,
  turnoDaCelula,
  type LinhaPlanilha,
  type MarcacaoAtual,
  type TurnoAgenda,
  chaveNome,
  ehVagaDeReserva,
  linhaAtiva,
  observacaoDoRobo,
  ehDaPlanilha,
} from "@isphub/shared";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { baixar, type ContaServico } from "../lib/googleDrive.js";
import { prisma } from "../lib/prisma.js";
import { lerAbas, type Celula } from "../lib/xlsx.js";
import { HttpError } from "../middleware/errorHandler.js";
import * as agenda from "./agendaService.js";
import { hashPassword } from "./authService.js";
import { atribuirTecnico } from "./writebackService.js";

/**
 * Robo planilha -> ISPhub (ponte ate a planilha parar de ser usada).
 *
 * Decide cada linha com `decidirLinha` (shared) e grava pelo MESMO
 * `agenda.marcar()` de todo mundo — teto, feriado e sabado-so-manha valem
 * igual. Nao usa chave de parceiro: "Ligar agendamento" no painel nao o derruba.
 *
 * O .xlsx chega por dois caminhos, que caem no mesmo `processarPlanilha`:
 *  - **Apps Script** na conta Google de quem ja enxerga a planilha manda o
 *    arquivo a cada 15 min pra `POST /api/planilha/receber` (o caminho usado na
 *    NetGo: a organizacao bloqueia chave de conta de servico);
 *  - **conta de servico** (GOOGLE_SA_JSON + PLANILHA_SYNC_FILE_ID): o proprio job
 *    baixa do Drive.
 */

/** Mais que isto numa rodada = algo errado (arquivo trocado, coluna deslocada): para e avisa. */
const LIMITE_POR_RODADA = 30;

type Item = { os: string; motivo: string };

export interface RodadaPlanilha {
  quando: Date;
  ativo: boolean;
  /** Motivo de nao ter processado nada nesta rodada ("planilha sem alteração"). */
  pulada: string | null;
  lidas: number;
  marcadas: string[];
  desmarcadas: string[];
  recusadas: Item[];
  conflitos: Item[];
  ignoradas: Item[];
  trava: string | null;
  erro: string | null;
  /** Tecnicos da aba Configuracoes que nao existiam e foram cadastrados (sem login). */
  tecnicosCriados: string[];
  /** OS que receberam (ou trocaram de) tecnico vindo da planilha. */
  atribuidas: { os: string; tecnico: string }[];
  /** Marcacoes da planilha que tiveram ordem da rota ou observacao atualizada. */
  detalhesAtualizados: number;
}

let ultima: RodadaPlanilha | null = null;
export const ultimaRodadaPlanilha = () => ultima;
let ultimoHash = "";
let ultimoAviso = "";
let rodando = false;

const vazia = (quando: Date, ativo: boolean): RodadaPlanilha => ({
  quando, ativo, pulada: null, lidas: 0,
  marcadas: [], desmarcadas: [], recusadas: [], conflitos: [], ignoradas: [], trava: null, erro: null,
  tecnicosCriados: [], atribuidas: [], detalhesAtualizados: 0,
});

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[º°]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Linhas das abas "Agendamentos - ...". Acha o cabecalho pela coluna "Nº OS" e
 * le as colunas pelo NOME: coluna mudada de lugar nao quebra; coluna sumida
 * para o robo (melhor que gravar a coluna errada).
 */
export function linhasDaPlanilha(abas: Map<string, Celula[][]>): LinhaPlanilha[] {
  const saida: LinhaPlanilha[] = [];
  for (const [nomeAba, linhas] of abas) {
    const n = norm(nomeAba);
    if (!n.startsWith("agendamentos")) continue;
    const aba = n.includes("reparo") ? "reparo" : "instalacao";

    const iCab = linhas.findIndex((l) => l?.some((c) => norm(c) === "n os"));
    if (iCab < 0) throw new Error(`aba "${nomeAba}": cabeçalho "Nº OS" não encontrado`);
    const cab = linhas[iCab]!.map(norm);
    const col = (nome: string) => {
      const i = cab.indexOf(nome);
      if (i < 0) throw new Error(`aba "${nomeAba}": coluna "${nome}" não encontrada`);
      return i;
    };
    const [cOs, cDia, cTurno, cStatus, cAtendente] = [col("n os"), col("data agendada"), col("turno"), col("status"), col("atendente")];
    // Colunas do supervisor e a de observacao: opcionais — sem elas o robo so nao copia esses dados.
    const [cTecnico, cOrdem, cObs] = [cab.indexOf("tecnico designado"), cab.indexOf("ordem da rota"), cab.indexOf("observacoes")];
    const texto = (l: Celula[], i: number) => (i >= 0 && l[i] != null && String(l[i]).trim() ? String(l[i]).trim() : null);

    for (const l of linhas.slice(iCab + 1)) {
      if (!l || !l.some((c) => c != null && String(c).trim() !== "")) continue;
      saida.push({
        os: osDaCelula(l[cOs]),
        dia: diaDaCelula(l[cDia]),
        turno: turnoDaCelula(l[cTurno]),
        status: String(l[cStatus] ?? "").trim(),
        atendente: l[cAtendente] != null ? String(l[cAtendente]).trim() || null : null,
        aba,
        tecnico: texto(l, cTecnico),
        ordem: cOrdem >= 0 && Number.isInteger(Number(l[cOrdem])) && Number(l[cOrdem]) > 0 ? Number(l[cOrdem]) : null,
        observacao: texto(l, cObs),
      });
    }
  }
  return saida;
}

/**
 * A lista "Tecnicos" da aba Configuracoes (coluna com esse cabecalho), sem as
 * vagas de reserva ("Tecnico 16"...). Aba ou coluna ausente = lista vazia.
 */
export function tecnicosDaPlanilha(abas: Map<string, Celula[][]>): string[] {
  const linhas = [...abas].find(([nome]) => norm(nome) === "configuracoes")?.[1] ?? [];
  for (let i = 0; i < linhas.length; i++) {
    const col = (linhas[i] ?? []).findIndex((c) => norm(c).startsWith("tecnicos"));
    if (col < 0) continue;
    const nomes: string[] = [];
    for (const l of linhas.slice(i + 1)) {
      const v = l?.[col] != null ? String(l[col]).trim() : "";
      if (!v) break;
      if (!ehVagaDeReserva(v)) nomes.push(v);
    }
    return nomes;
  }
  return [];
}

/**
 * Cadastra SEM LOGIN os tecnicos da planilha que ainda nao existem (decisao de
 * 23/10/2026): so pra poderem receber OS e rota. Senha = segredo aleatorio que
 * ninguem conhece; e-mail placeholder em dominio .invalid. O admin libera o
 * acesso depois em /admin/usuarios (troca e-mail e senha).
 */
async function garantirTecnicos(nomes: string[], r: RodadaPlanilha): Promise<Map<string, string>> {
  const existentes = await prisma.usuario.findMany({ where: { role: UserRole.TECNICO }, select: { id: true, nome: true } });
  const porNome = new Map(existentes.map((u) => [chaveNome(u.nome), u.id]));
  for (const nome of nomes) {
    const chave = chaveNome(nome);
    if (!chave || porNome.has(chave)) continue;
    const slug = chave.replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
    const u = await prisma.usuario.create({
      data: {
        nome,
        email: `${slug}@sem-login.isphub.invalid`,
        senhaHash: await hashPassword(randomBytes(32).toString("hex")),
        role: UserRole.TECNICO,
      },
      select: { id: true },
    });
    porNome.set(chave, u.id);
    r.tecnicosCriados.push(nome);
  }
  return porNome;
}

/**
 * Tecnico, ordem da rota e observacao das linhas ATIVAS. Vale a mesma regra das
 * visitas: so mexe no que veio da planilha — tecnico atribuido por alguem no
 * ISPhub, ou marcacao de outra origem, viram conflito e ficam como estao.
 */
async function aplicarDetalhes(
  provedorId: string,
  linhas: LinhaPlanilha[],
  tecnicoPorNome: Map<string, string>,
  r: RodadaPlanilha,
) {
  const ativas = linhas.filter((l) => l.os && linhaAtiva(l));
  if (ativas.length === 0) return;
  const oss = ativas.map((l) => l.os!);
  const [marcacoes, ordens] = await Promise.all([
    prisma.agendamento.findMany({
      where: { provedorId, sgpOsId: { in: oss }, status: "marcado" },
      select: { id: true, sgpOsId: true, dia: true, turno: true, origem: true, observacao: true, ordemRota: true },
    }),
    prisma.ordemServico.findMany({
      where: { provedorId, sgpOsId: { in: oss } },
      select: {
        id: true, sgpOsId: true, status: true, tecnicoId: true,
        atribuicoes: { orderBy: { atribuidoEm: "desc" }, take: 1, select: { atribuidoPor: true } },
      },
    }),
  ]);
  const marcacaoDe = new Map(marcacoes.map((m) => [m.sgpOsId, m]));
  const osDe = new Map(ordens.map((o) => [o.sgpOsId, o]));
  const ABERTA = ["aberta", "pendente", "em_deslocamento", "em_execucao"];

  for (const l of ativas) {
    // Ordem da rota e observacao: so na marcacao da planilha que bate com a linha.
    const m = marcacaoDe.get(l.os!);
    if (m && ehDaPlanilha(m) && m.dia.toISOString().slice(0, 10) === l.dia && m.turno === l.turno) {
      const obs = observacaoDoRobo(l.observacao);
      const ordem = l.ordem ?? m.ordemRota;
      if (m.observacao !== obs || m.ordemRota !== ordem) {
        await prisma.agendamento.update({ where: { id: m.id }, data: { observacao: obs, ordemRota: ordem } });
        r.detalhesAtualizados++;
      }
    }

    // Tecnico: so com a OS espelhada e aberta, e tecnico conhecido.
    const os = osDe.get(l.os!);
    const tecnicoId = l.tecnico ? tecnicoPorNome.get(chaveNome(l.tecnico)) : undefined;
    if (!os || !ABERTA.includes(os.status) || !tecnicoId || os.tecnicoId === tecnicoId) continue;
    const doRobo = !os.tecnicoId || os.atribuicoes[0]?.atribuidoPor === ORIGEM_PLANILHA;
    if (!doRobo) {
      r.conflitos.push({ os: l.os!, motivo: `técnico no ISPhub difere do da planilha (${l.tecnico}); mantido o do ISPhub` });
      continue;
    }
    await atribuirTecnico(os.id, tecnicoId, null, ORIGEM_PLANILHA);
    r.atribuidas.push({ os: l.os!, tecnico: l.tecnico! });
  }
}

/** Avisa admin/gestor so quando o problema MUDA — senao seria um aviso a cada 15 min. */
async function avisarSeMudou(r: RodadaPlanilha) {
  const partes = [
    r.erro ? `erro: ${r.erro}` : "",
    r.trava ? `trava: ${r.trava}` : "",
    ...r.conflitos.map((c) => `OS ${c.os}: ${c.motivo}`),
  ].filter(Boolean);
  const chave = partes.join("|");
  if (chave === ultimoAviso) return;
  ultimoAviso = chave;
  if (!chave) return;
  const gestores = await prisma.usuario.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
    select: { id: true },
  });
  const mensagem = `Robô da planilha: ${partes.slice(0, 3).join(" · ")}${partes.length > 3 ? ` (+${partes.length - 3})` : ""}`;
  await prisma.notificacao.createMany({
    data: gestores.map((g) => ({ usuarioId: g.id, tipo: "planilha_sync", mensagem: mensagem.slice(0, 500) })),
  });
}

/** Aplica um .xlsx ja em memoria. Mesmo arquivo da rodada anterior (por hash) = nada a fazer. */
export async function processarPlanilha(buf: Buffer, provedorNome: string, agora = new Date()): Promise<RodadaPlanilha> {
  if (rodando) return ultima ?? vazia(agora, true);
  rodando = true;
  const r = vazia(agora, true);
  try {
    const hash = createHash("sha256").update(buf).digest("hex");
    // Erro ou trava na anterior: processa de novo mesmo sem mudanca (pode ter sido o banco).
    if (hash === ultimoHash && ultima && !ultima.erro && !ultima.trava) {
      return (ultima = { ...ultima, quando: agora, pulada: "planilha sem alteração" });
    }

    const provedor = await prisma.provedor.findFirst({
      where: { nome: { equals: provedorNome, mode: "insensitive" } },
      select: { id: true },
    });
    if (!provedor) throw new Error(`provedor "${provedorNome}" não existe no ISPhub`);

    const abas = lerAbas(buf);
    const linhas = consolidarLinhas(linhasDaPlanilha(abas));
    r.lidas = linhas.length;
    const oss = linhas.map((l) => l.os).filter((o): o is string => o != null);

    const [atuais, espelho] = await Promise.all([
      prisma.agendamento.findMany({
        where: { provedorId: provedor.id, sgpOsId: { in: oss } },
        select: { id: true, sgpOsId: true, dia: true, turno: true, status: true, origem: true, observacao: true },
      }),
      prisma.ordemServico.findMany({
        where: { provedorId: provedor.id, sgpOsId: { in: oss } },
        select: { sgpOsId: true, status: true, pop: true },
      }),
    ]);
    const atualDe = new Map<string, MarcacaoAtual>(
      atuais.map((a) => [
        a.sgpOsId,
        { id: a.id, dia: a.dia.toISOString().slice(0, 10), turno: a.turno as TurnoAgenda, status: a.status, origem: a.origem, observacao: a.observacao },
      ]),
    );
    const osDe = new Map(espelho.map((o) => [o.sgpOsId, o]));
    const hoje = agenda.diaBrDe(agora);

    const acoes: { linha: LinhaPlanilha; tipo: "marcar" | "desmarcar"; id?: string }[] = [];
    for (const linha of linhas) {
      const os = linha.os ? osDe.get(linha.os) : undefined;
      const d = decidirLinha({
        linha,
        atual: linha.os ? (atualDe.get(linha.os) ?? null) : null,
        hoje,
        osAberta: os ? ["aberta", "pendente", "em_deslocamento", "em_execucao"].includes(os.status) : null,
      });
      const ref = linha.os ?? `(linha sem OS, aba ${linha.aba})`;
      if (d.tipo === "marcar") acoes.push({ linha, tipo: "marcar" });
      else if (d.tipo === "desmarcar") acoes.push({ linha, tipo: "desmarcar", id: d.id });
      else if (d.tipo === "conflito") r.conflitos.push({ os: ref, motivo: d.motivo });
      else if (d.tipo === "ignorar") r.ignoradas.push({ os: ref, motivo: d.motivo });
    }

    if (acoes.length > LIMITE_POR_RODADA) {
      r.trava = `a planilha pediu ${acoes.length} mudanças de uma vez (limite ${LIMITE_POR_RODADA}); nada foi gravado`;
      return (ultima = r);
    }

    for (const a of acoes) {
      const os = a.linha.os!;
      if (a.tipo === "desmarcar") {
        await agenda.cancelar(a.id!);
        void agenda.limparNoSgp(a.id!);
        r.desmarcadas.push(os);
        continue;
      }
      try {
        const m = await agenda.marcar({
          provedorId: provedor.id,
          sgpOsId: os,
          dia: a.linha.dia!,
          turno: a.linha.turno!,
          regiao: osDe.get(os)?.pop ?? null,
          origem: ORIGEM_PLANILHA,
          marcadoPor: a.linha.atendente ?? "planilha",
          observacao: observacaoDoRobo(a.linha.observacao),
          ignorarLotacao: true,
        });
        void agenda.enviarAoSgp(m.id);
        r.marcadas.push(os);
      } catch (e) {
        // 409 e regra (turno cheio, domingo, feriado): vai pro relatorio, a rodada segue.
        if (e instanceof HttpError && e.status === 409) r.recusadas.push({ os, motivo: e.message });
        else throw e;
      }
    }
    await aplicarDetalhes(provedor.id, linhas, await garantirTecnicos(tecnicosDaPlanilha(abas), r), r);
    // So marca como "visto" o que foi processado inteiro: erro ou trava tentam de novo.
    ultimoHash = hash;
    return (ultima = r);
  } catch (e) {
    r.erro = e instanceof Error ? e.message : String(e);
    return (ultima = r);
  } finally {
    rodando = false;
    if (ultima) await avisarSeMudou(ultima).catch((e) => console.error("[planilha-sync] aviso falhou:", e));
  }
}

/** Modo conta de servico: o job baixa do Drive. Sem as envs, nao faz nada. */
export async function rodarPlanilha(agora = new Date()): Promise<RodadaPlanilha | null> {
  if (!env.GOOGLE_SA_JSON || !env.PLANILHA_SYNC_FILE_ID || !env.PLANILHA_SYNC_PROVEDOR) return ultima;
  try {
    const buf = await baixar(JSON.parse(env.GOOGLE_SA_JSON) as ContaServico, env.PLANILHA_SYNC_FILE_ID);
    return await processarPlanilha(buf, env.PLANILHA_SYNC_PROVEDOR, agora);
  } catch (e) {
    return (ultima = { ...vazia(agora, true), erro: e instanceof Error ? e.message : String(e) });
  }
}
