import {
  ALARMES_VEICULO,
  ALARME_GRAVE,
  agruparLinhaDoVeiculo,
  limitesDoDia,
  type AlarmeVeiculo,
  type ItemLinhaVeiculo,
  type LinhaDoVeiculo,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";

/**
 * A LINHA DO TEMPO de um veiculo num periodo de dias (fuso de Brasilia).
 *
 * Cada fonte tem teto de linhas: um carro com rastreador mal configurado pode
 * gerar milhares de "sem comunicacao" num mes, e isso nao pode derrubar a tela.
 * Quando alguma bate no teto, a resposta avisa (`truncado`) e a tela sugere um
 * periodo menor — em vez de mostrar um historico incompleto como se fosse tudo.
 */

export const TETO_POR_FONTE = 500;
/** Periodo maximo, em dias. Mais que isso e relatorio, nao linha do tempo. */
export const MAX_DIAS = 31;

function nomeDe(u: { nome: string; nomeExibicao: string | null } | null | undefined): string | null {
  return u ? u.nomeExibicao || u.nome : null;
}

export async function linhaDoVeiculo(veiculoId: string, deDia: string, ateDia: string, agora = new Date()): Promise<LinhaDoVeiculo> {
  const de = limitesDoDia(deDia).inicio;
  const ate = limitesDoDia(ateDia).fim;
  const noPeriodo = { gte: de, lt: ate };
  const usuarioNome = { select: { nome: true, nomeExibicao: true } } as const;

  const [ocupacoes, checklists, abastecimentos, manutencoes, alarmes, fixas] = await Promise.all([
    // Pegou OU devolveu dentro do periodo — a ocupacao que comecou antes e
    // terminou dentro aparece so com a devolucao, e vice-versa.
    prisma.ocupacaoVeiculo.findMany({
      where: { veiculoId, OR: [{ inicioEm: noPeriodo }, { fimEm: noPeriodo }] },
      orderBy: { inicioEm: "desc" },
      take: TETO_POR_FONTE,
      select: {
        inicioEm: true,
        fimEm: true,
        papel: true,
        origem: true,
        encerradoPor: true,
        odometroInicio: true,
        odometroFim: true,
        usuario: usuarioNome,
        declaradoPor: usuarioNome,
      },
    }),
    prisma.checklistViatura.findMany({
      where: { veiculoId, criadoEm: noPeriodo },
      orderBy: { criadoEm: "desc" },
      take: TETO_POR_FONTE,
      // A foto NAO vem aqui (sao bytes): a tela busca cada uma pela rota da foto.
      select: { id: true, momento: true, odometroKm: true, combustivelPct: true, avarias: true, fotoMime: true, criadoEm: true, usuarioId: true },
    }),
    prisma.abastecimento.findMany({
      // `data` e DATE: compara com os dias do periodo, nao com instantes.
      where: { veiculoId, data: { gte: new Date(`${deDia}T00:00:00Z`), lte: new Date(`${ateDia}T00:00:00Z`) } },
      orderBy: { data: "desc" },
      take: TETO_POR_FONTE,
      select: {
        data: true,
        km: true,
        litros: true,
        valorTotal: true,
        combustivel: true,
        posto: true,
        tanqueCheio: true,
        responsavel: usuarioNome,
      },
    }),
    prisma.manutencaoRealizada.findMany({
      where: { veiculoId, em: noPeriodo },
      orderBy: { em: "desc" },
      take: TETO_POR_FONTE,
      select: { tipo: true, km: true, em: true, registradoPor: true },
    }),
    prisma.eventoRastreador.findMany({
      where: { veiculoId, em: noPeriodo, tipo: { in: [...ALARMES_VEICULO] } },
      orderBy: { em: "desc" },
      take: TETO_POR_FONTE,
      select: { tipo: true, em: true },
    }),
    prisma.viaturaFixa.findMany({
      where: { veiculoId, OR: [{ inicioEm: noPeriodo }, { fimEm: noPeriodo }] },
      orderBy: { inicioEm: "desc" },
      take: TETO_POR_FONTE,
      select: { inicioEm: true, fimEm: true, definidoPor: true, encerradoPor: true, usuario: usuarioNome },
    }),
  ]);

  // Nomes sem FK (checklist, manutencao, carro fixo): uma busca so.
  const ids = new Set<string>();
  for (const c of checklists) ids.add(c.usuarioId);
  for (const m of manutencoes) if (m.registradoPor) ids.add(m.registradoPor);
  for (const f of fixas) {
    ids.add(f.definidoPor);
    if (f.encerradoPor) ids.add(f.encerradoPor);
  }
  const nomes = new Map(
    (await prisma.usuario.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nome: true, nomeExibicao: true } })).map(
      (u) => [u.id, nomeDe(u)!],
    ),
  );

  const dentro = (d: Date) => d >= de && d < ate;
  const itens: ItemLinhaVeiculo[] = [];

  for (const o of ocupacoes) {
    const quem = nomeDe(o.usuario) ?? "—";
    if (dentro(o.inicioEm)) {
      itens.push({
        tipo: "retirada",
        em: o.inicioEm.toISOString(),
        usuarioNome: quem,
        papel: o.papel,
        origem: o.origem,
        declaradoPorNome: nomeDe(o.declaradoPor) ?? "—",
        odometroKm: o.odometroInicio,
      });
    }
    if (o.fimEm && dentro(o.fimEm)) {
      itens.push({ tipo: "devolucao", em: o.fimEm.toISOString(), usuarioNome: quem, papel: o.papel, motivo: o.encerradoPor, odometroKm: o.odometroFim });
    }
  }

  for (const c of checklists) {
    itens.push({
      tipo: "checklist",
      em: c.criadoEm.toISOString(),
      id: c.id,
      momento: c.momento === "retorno" ? "retorno" : "saida",
      usuarioNome: nomes.get(c.usuarioId) ?? "—",
      odometroKm: c.odometroKm,
      combustivelPct: c.combustivelPct,
      avarias: c.avarias,
      temFoto: !!c.fotoMime,
    });
  }

  for (const a of abastecimentos) {
    itens.push({
      tipo: "abastecimento",
      // Meio-dia de Brasilia: cai no dia certo em qualquer fuso; a tela nao mostra a hora.
      em: new Date(`${a.data.toISOString().slice(0, 10)}T15:00:00Z`).toISOString(),
      semHora: true,
      litros: Number(a.litros),
      valorTotal: Number(a.valorTotal),
      km: a.km,
      combustivel: a.combustivel,
      posto: a.posto,
      tanqueCheio: a.tanqueCheio,
      responsavelNome: nomeDe(a.responsavel),
    });
  }

  for (const m of manutencoes) {
    itens.push({
      tipo: "manutencao",
      em: m.em.toISOString(),
      servico: m.tipo,
      km: m.km,
      registradoPorNome: m.registradoPor ? (nomes.get(m.registradoPor) ?? null) : null,
    });
  }

  for (const e of alarmes) {
    const evento = e.tipo as AlarmeVeiculo;
    itens.push({ tipo: "alarme", em: e.em.toISOString(), evento, grave: ALARME_GRAVE[evento] });
  }

  for (const f of fixas) {
    const quem = nomeDe(f.usuario) ?? "—";
    if (dentro(f.inicioEm)) {
      itens.push({ tipo: "carro_fixo", em: f.inicioEm.toISOString(), usuarioNome: quem, acao: "definido", porNome: nomes.get(f.definidoPor) ?? null });
    }
    if (f.fimEm && dentro(f.fimEm)) {
      itens.push({
        tipo: "carro_fixo",
        em: f.fimEm.toISOString(),
        usuarioNome: quem,
        acao: "encerrado",
        porNome: f.encerradoPor ? (nomes.get(f.encerradoPor) ?? null) : null,
      });
    }
  }

  const truncado = [ocupacoes, checklists, abastecimentos, manutencoes, alarmes, fixas].some((l) => l.length >= TETO_POR_FONTE);
  return {
    de: de.toISOString(),
    ate: ate.toISOString(),
    agoraServidor: agora.toISOString(),
    dias: agruparLinhaDoVeiculo(itens),
    truncado,
  };
}
