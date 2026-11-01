import { prisma } from "../lib/prisma.js";
import { buildConnector } from "./erpConnectorService.js";

/**
 * PRODUCAO DO VENDEDOR — quanto ele vendeu no mes, com cara de jogo: meta,
 * nivel, sequencia de dias, posicao entre os vendedores do provedor e
 * conquistas. Mesma linha do painel do tecnico (meuDesempenhoService): a
 * posicao e privada — ele ve onde esta e quanto falta pro lider, nao os nomes.
 *
 * Venda = pre-cadastro enviado (o SGP criou o contrato). "Agendada na hora" =
 * o vendedor ja saiu com a instalacao marcada. "Instalada" = a OS de instalacao
 * foi concluida; "ativa" = instalada e com o contrato ativo no SGP.
 *
 * ponytail: meta fixa no codigo (30/mes); vira campo do provedor quando a
 * NetGo definir a dela.
 */
export const META_MENSAL = 30;

export const NIVEIS = [
  { nome: "Bronze", minimo: 0 },
  { nome: "Prata", minimo: 10 },
  { nome: "Ouro", minimo: 20 },
  { nome: "Diamante", minimo: META_MENSAL },
] as const;

/** Dia civil de Brasilia (-03:00 fixo, como o resto do sistema). */
export function diaBr(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export interface VendaLinha {
  vendedorId: string;
  criadoEm: Date;
  status: string;
  /** A OS de instalacao foi concluida. */
  instalada?: boolean;
  /** Instalada e com o contrato ativo no SGP. */
  ativa?: boolean;
}

export interface Conquista {
  id: string;
  nome: string;
  descricao: string;
  desbloqueada: boolean;
}

export interface ProducaoVendedor {
  mes: string;
  vendasMes: number;
  vendasSemana: number;
  vendasHoje: number;
  agendadasNaHora: number;
  /** Vendas do mes ja instaladas (OS concluida) e, delas, as com contrato ativo. */
  instaladasMes: number;
  ativasMes: number;
  /** 0..100 — das vendas do mes, quantas sairam com a instalacao marcada. */
  taxaAgendadaNaHora: number;
  meta: number;
  progressoMeta: number;
  faltamParaMeta: number;
  nivel: { atual: string; proximo: string | null; faltamParaProximo: number };
  /** Dias seguidos com pelo menos uma venda, terminando hoje (ou ontem, se hoje ainda nao vendeu). */
  sequenciaDias: number;
  ranking: { posicao: number; total: number; vendasLider: number; faltamParaLider: number };
  /** Vendas por dia do mes, do dia 1 ate hoje. */
  porDia: { dia: string; vendas: number }[];
  conquistas: Conquista[];
}

/** O calculo, sem banco: as vendas do provedor no mes e quem e o vendedor. */
export function calcularProducao(args: { vendedorId: string; vendas: VendaLinha[]; agora: Date }): ProducaoVendedor {
  const hoje = diaBr(args.agora);
  const mes = hoje.slice(0, 7);
  const doMes = args.vendas.filter((v) => diaBr(v.criadoEm).startsWith(mes));
  const minhas = doMes.filter((v) => v.vendedorId === args.vendedorId);

  // Semana comecando na segunda (dia civil de Brasilia).
  const hojeData = new Date(`${hoje}T12:00:00Z`);
  const desdeSegunda = (hojeData.getUTCDay() + 6) % 7;
  const segunda = new Date(hojeData.getTime() - desdeSegunda * 86_400_000).toISOString().slice(0, 10);

  const porDiaMapa = new Map<string, number>();
  for (const v of minhas) {
    const d = diaBr(v.criadoEm);
    porDiaMapa.set(d, (porDiaMapa.get(d) ?? 0) + 1);
  }
  const porDia: { dia: string; vendas: number }[] = [];
  for (let n = 1; n <= Number(hoje.slice(8, 10)); n++) {
    const dia = `${mes}-${String(n).padStart(2, "0")}`;
    porDia.push({ dia, vendas: porDiaMapa.get(dia) ?? 0 });
  }

  const vendasMes = minhas.length;
  const vendasHoje = porDiaMapa.get(hoje) ?? 0;
  const vendasSemana = porDia.filter((p) => p.dia >= segunda).reduce((n, p) => n + p.vendas, 0);
  const agendadasNaHora = minhas.filter((v) => v.status === "agendado").length;
  const instaladasMes = minhas.filter((v) => v.instalada).length;
  const ativasMes = minhas.filter((v) => v.ativa).length;

  // Sequencia: conta para tras a partir de hoje; hoje sem venda ainda nao quebra (o dia nao acabou).
  let sequenciaDias = 0;
  const comVenda = new Set(porDiaMapa.keys());
  let cursor = comVenda.has(hoje) ? hojeData : new Date(hojeData.getTime() - 86_400_000);
  while (comVenda.has(cursor.toISOString().slice(0, 10))) {
    sequenciaDias++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }

  const nivelIdx = NIVEIS.reduce((idx, n, i) => (vendasMes >= n.minimo ? i : idx), 0);
  const proximo = NIVEIS[nivelIdx + 1] ?? null;

  // Ranking entre os vendedores do provedor que venderam no mes (ele entra mesmo com zero).
  const porVendedor = new Map<string, number>([[args.vendedorId, 0]]);
  for (const v of doMes) porVendedor.set(v.vendedorId, (porVendedor.get(v.vendedorId) ?? 0) + 1);
  const totais = [...porVendedor.values()].sort((a, b) => b - a);
  const vendasLider = totais[0] ?? 0;
  const posicao = totais.filter((t) => t > vendasMes).length + 1;

  const maxNoDia = Math.max(0, ...porDia.map((p) => p.vendas));
  const conquistas: Conquista[] = [
    { id: "primeira", nome: "Primeira venda", descricao: "Fez a primeira venda do mês.", desbloqueada: vendasMes >= 1 },
    { id: "instalada", nome: "Cliente ligado", descricao: "Primeira venda do mês instalada e com contrato ativo.", desbloqueada: ativasMes >= 1 },
    { id: "na_hora", nome: "Agendou na hora", descricao: "Saiu da casa do cliente com a instalação marcada.", desbloqueada: agendadasNaHora >= 1 },
    { id: "dia_cheio", nome: "Dia cheio", descricao: "5 vendas no mesmo dia.", desbloqueada: maxNoDia >= 5 },
    { id: "sequencia", nome: "Embalado", descricao: "5 dias seguidos vendendo.", desbloqueada: sequenciaDias >= 5 },
    { id: "dezena", nome: "Dezena", descricao: "10 vendas no mês.", desbloqueada: vendasMes >= 10 },
    { id: "meta", nome: "Meta batida", descricao: `${META_MENSAL} vendas no mês.`, desbloqueada: vendasMes >= META_MENSAL },
  ];

  return {
    mes,
    vendasMes,
    vendasSemana,
    vendasHoje,
    agendadasNaHora,
    instaladasMes,
    ativasMes,
    taxaAgendadaNaHora: vendasMes ? Math.round((agendadasNaHora / vendasMes) * 100) : 0,
    meta: META_MENSAL,
    progressoMeta: Math.min(100, Math.round((vendasMes / META_MENSAL) * 100)),
    faltamParaMeta: Math.max(0, META_MENSAL - vendasMes),
    nivel: { atual: NIVEIS[nivelIdx]!.nome, proximo: proximo?.nome ?? null, faltamParaProximo: proximo ? proximo.minimo - vendasMes : 0 },
    sequenciaDias,
    ranking: { posicao, total: totais.length, vendasLider, faltamParaLider: Math.max(0, vendasLider - vendasMes) },
    porDia,
    conquistas,
  };
}

/**
 * Contrato ativo? Le ao vivo do SGP (o espelho so atualiza o status do contrato
 * enquanto a OS esta aberta — depois de instalada, ele congela no de antes).
 * Cache de 1 h por OS: a tela abre varias vezes por dia e o SGP nao precisa
 * responder a mesma pergunta a cada abertura.
 */
const cacheAtivo = new Map<string, { ativo: boolean; em: number }>();
const CACHE_ATIVO_MS = 3_600_000;
const MAX_CONSULTAS_SGP = 10;

async function contratosAtivos(provedorId: string, alvos: { sgpOsId: string; contratoId: string | null }[]): Promise<Set<string>> {
  const ativos = new Set<string>();
  const agora = Date.now();
  const faltam: typeof alvos = [];
  for (const a of alvos) {
    const c = cacheAtivo.get(`${provedorId}|${a.sgpOsId}`);
    if (c && agora - c.em < CACHE_ATIVO_MS) {
      if (c.ativo) ativos.add(a.sgpOsId);
    } else faltam.push(a);
  }
  if (faltam.length === 0) return ativos;
  const erp = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
  if (!erp) return ativos;
  const conector = buildConnector(erp);
  // ponytail: no maximo 10 por abertura; o resto entra nas proximas (o cache acumula).
  await Promise.all(
    faltam.slice(0, MAX_CONSULTAS_SGP).map(async (a) => {
      try {
        const ficha = await conector.obterFichaOs(a.sgpOsId, a.contratoId);
        const ativo = /^ativo/i.test(ficha?.contratoStatus?.trim() ?? "");
        cacheAtivo.set(`${provedorId}|${a.sgpOsId}`, { ativo, em: Date.now() });
        if (ativo) ativos.add(a.sgpOsId);
      } catch {
        // SGP fora: conta como nao confirmado agora; a proxima abertura tenta de novo.
      }
    }),
  );
  return ativos;
}

/** Le as vendas do mes do provedor e calcula a producao do vendedor. */
export async function producaoDoVendedor(vendedorId: string, provedorId: string, agora = new Date()): Promise<ProducaoVendedor> {
  const mes = diaBr(agora).slice(0, 7);
  // Folga de um dia de cada lado: o corte do mes e feito pelo dia de Brasilia em `calcularProducao`.
  const de = new Date(`${mes}-01T00:00:00Z`);
  de.setUTCDate(de.getUTCDate() - 1);
  const linhas = await prisma.preCadastro.findMany({
    where: { provedorId, criadoEm: { gte: de } },
    select: { vendedorId: true, criadoEm: true, status: true, sgpOsId: true, contratoId: true },
  });

  // Instalada: a OS de instalacao concluida no espelho (so as do proprio vendedor importam).
  const minhasComOs = linhas.filter((l) => l.vendedorId === vendedorId && l.sgpOsId);
  const oss = minhasComOs.length
    ? await prisma.ordemServico.findMany({
        where: { provedorId, sgpOsId: { in: minhasComOs.map((l) => l.sgpOsId!) } },
        select: { sgpOsId: true, status: true },
      })
    : [];
  const concluidas = new Set(oss.filter((o) => o.status === "concluida").map((o) => o.sgpOsId));
  const ativos = await contratosAtivos(
    provedorId,
    minhasComOs.filter((l) => concluidas.has(l.sgpOsId!)).map((l) => ({ sgpOsId: l.sgpOsId!, contratoId: l.contratoId })),
  );

  const vendas: VendaLinha[] = linhas.map((l) => ({
    vendedorId: l.vendedorId,
    criadoEm: l.criadoEm,
    status: l.status,
    instalada: !!l.sgpOsId && concluidas.has(l.sgpOsId),
    ativa: !!l.sgpOsId && ativos.has(l.sgpOsId),
  }));
  return calcularProducao({ vendedorId, vendas, agora });
}
