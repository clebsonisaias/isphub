import { OsStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface MeuDesempenhoDto {
  periodo: "semana" | "mes";
  inicioPeriodo: string;
  fimPeriodo: string;
  ranking: {
    posicao: number;
    totalTecnicos: number;
    titulo: string;
    diferencaParaLider: number;
  };
  pessoal: {
    osConcluidas: number;
    osConcluidasSemana: number;
    osConcluidasMes: number;
    tempoMedioMinutos: number;
    notaMedia: number;
    totalAvaliacoes: number;
    metaSemanal: number;
    progressoMetaPct: number;
  };
  benchmarksEquipe: {
    liderOs: number;
    mediaEquipeOs: number;
    tempoMedioEquipeMin: number;
  };
  insignias: Array<{
    id: string;
    nome: string;
    descricao: string;
    icone: string;
    desbloqueada: boolean;
  }>;
}

function obterIntervalo(tipo: "semana" | "mes"): { de: Date; ate: Date } {
  const agora = new Date();
  const ate = new Date(agora);

  if (tipo === "mes") {
    // Primeiro dia do mês atual
    const de = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
    return { de, ate };
  }

  // Segunda-feira da semana atual
  const diaSemana = agora.getDay(); // 0 = Domingo, 1 = Segunda, ...
  const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const de = new Date(agora);
  de.setDate(agora.getDate() + diffSegunda);
  de.setHours(0, 0, 0, 0);

  return { de, ate };
}

export async function calcularMeuDesempenho(
  usuarioId: string,
  provedorId?: string | null,
  periodo: "semana" | "mes" = "semana",
): Promise<MeuDesempenhoDto> {
  const { de, ate } = obterIntervalo(periodo);

  // Intervalo do mês inteiro para métrica mensal
  const inicioMes = new Date(ate.getFullYear(), ate.getMonth(), 1, 0, 0, 0, 0);

  // Escopo de provedor
  const escopoProvedor = provedorId ? { provedorId } : {};

  // 1. Lista todos os técnicos ativos da equipe
  const tecnicos = await prisma.usuario.findMany({
    where: {
      role: UserRole.tecnico,
      ativo: true,
      ...escopoProvedor,
    },
    select: { id: true, nome: true },
  });

  const idsTecnicos = tecnicos.map((t) => t.id);
  // Garante que o usuário logado está na lista se for técnico
  if (!idsTecnicos.includes(usuarioId)) {
    idsTecnicos.push(usuarioId);
  }

  // 2. Busca todos os eventos de conclusão no período selecionado
  const eventosConclusao = await prisma.osEvento.findMany({
    where: {
      statusPara: OsStatus.concluida,
      criadoEm: { gte: de, lte: ate },
      ordemServico: {
        ...escopoProvedor,
        tecnicoId: { in: idsTecnicos },
      },
    },
    select: {
      ordemServicoId: true,
      criadoEm: true,
      ordemServico: {
        select: {
          id: true,
          tecnicoId: true,
          avaliacaoNota: true,
        },
      },
    },
  });

  // 3. Busca eventos de início (em_execucao ou em_deslocamento) para calcular duração média
  const osIds = [...new Set(eventosConclusao.map((e) => e.ordemServicoId))];
  const eventosInicio = osIds.length
    ? await prisma.osEvento.findMany({
        where: {
          ordemServicoId: { in: osIds },
          statusPara: { in: [OsStatus.em_execucao, OsStatus.em_deslocamento] },
        },
        select: {
          ordemServicoId: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: "asc" },
      })
    : [];

  const primeiroInicioPorOs = new Map<string, Date>();
  for (const ei of eventosInicio) {
    if (!primeiroInicioPorOs.has(ei.ordemServicoId)) {
      primeiroInicioPorOs.set(ei.ordemServicoId, ei.criadoEm);
    }
  }

  // 4. Também consulta o total do mês para o técnico atual
  const concluidasMesMeu = await prisma.osEvento.count({
    where: {
      statusPara: OsStatus.concluida,
      criadoEm: { gte: inicioMes, lte: ate },
      ordemServico: {
        tecnicoId: usuarioId,
      },
    },
  });

  // 5. Agrupa por técnico para o ranking anônimo
  interface MetricasTecnico {
    tecnicoId: string;
    concluidas: number;
    duracoesMin: number[];
    notas: number[];
  }

  const mapaTecnicos = new Map<string, MetricasTecnico>();
  for (const tId of idsTecnicos) {
    mapaTecnicos.set(tId, { tecnicoId: tId, concluidas: 0, duracoesMin: [], notas: [] });
  }

  for (const ev of eventosConclusao) {
    const tId = ev.ordemServico.tecnicoId;
    if (!tId) continue;
    let dados = mapaTecnicos.get(tId);
    if (!dados) {
      dados = { tecnicoId: tId, concluidas: 0, duracoesMin: [], notas: [] };
      mapaTecnicos.set(tId, dados);
    }
    dados.concluidas += 1;

    // Avaliação de cliente
    if (ev.ordemServico.avaliacaoNota && ev.ordemServico.avaliacaoNota >= 1 && ev.ordemServico.avaliacaoNota <= 5) {
      dados.notas.push(ev.ordemServico.avaliacaoNota);
    }

    // Duração
    const dtInicio = primeiroInicioPorOs.get(ev.ordemServicoId);
    if (dtInicio) {
      const duracaoMin = Math.round((ev.criadoEm.getTime() - dtInicio.getTime()) / 60_000);
      if (duracaoMin > 5 && duracaoMin < 480) {
        dados.duracoesMin.push(duracaoMin);
      }
    }
  }

  // 6. Ordena técnicos por produtividade: mais O.S. primeiro, desempate por menor tempo médio
  const listaOrdenada = Array.from(mapaTecnicos.values()).sort((a, b) => {
    if (b.concluidas !== a.concluidas) {
      return b.concluidas - a.concluidas;
    }
    const mediaA = a.duracoesMin.length ? a.duracoesMin.reduce((acc, v) => acc + v, 0) / a.duracoesMin.length : 999;
    const mediaB = b.duracoesMin.length ? b.duracoesMin.reduce((acc, v) => acc + v, 0) / b.duracoesMin.length : 999;
    return mediaA - mediaB;
  });

  // 7. Encontra a posição do técnico
  const idx = listaOrdenada.findIndex((t) => t.tecnicoId === usuarioId);
  const posicao = idx >= 0 ? idx + 1 : listaOrdenada.length;
  const totalTecnicos = Math.max(listaOrdenada.length, 1);

  const dadosMeu = mapaTecnicos.get(usuarioId) ?? {
    tecnicoId: usuarioId,
    concluidas: 0,
    duracoesMin: [],
    notas: [],
  };

  const tempoMedioMeu = dadosMeu.duracoesMin.length
    ? Math.round(dadosMeu.duracoesMin.reduce((acc, v) => acc + v, 0) / dadosMeu.duracoesMin.length)
    : 0;

  const notaMediaMeu = dadosMeu.notas.length
    ? Number((dadosMeu.notas.reduce((acc, v) => acc + v, 0) / dadosMeu.notas.length).toFixed(1))
    : 5.0; // Padrão 5.0 se não houver reclamação/avaliação negativa

  // Benchmarks anônimos da equipe
  const liderOs = listaOrdenada[0]?.concluidas ?? 0;
  const diferencaParaLider = Math.max(0, liderOs - dadosMeu.concluidas);

  const totalOsEquipe = listaOrdenada.reduce((acc, t) => acc + t.concluidas, 0);
  const mediaEquipeOs = Math.round(totalOsEquipe / totalTecnicos);

  const todasDuracoes = listaOrdenada.flatMap((t) => t.duracoesMin);
  const tempoMedioEquipeMin = todasDuracoes.length
    ? Math.round(todasDuracoes.reduce((acc, v) => acc + v, 0) / todasDuracoes.length)
    : 45;

  // Título motivacional de acordo com o ranking
  let tituloRanking = "Técnico de Campo";
  if (posicao === 1 && dadosMeu.concluidas > 0) {
    tituloRanking = "🥇 Líder Geral da Equipe";
  } else if (posicao === 2 && dadosMeu.concluidas > 0) {
    tituloRanking = "🥈 Vice-líder da Semana";
  } else if (posicao === 3 && dadosMeu.concluidas > 0) {
    tituloRanking = "🥉 Top 3 da Equipe";
  } else if (posicao <= Math.ceil(totalTecnicos * 0.5) && dadosMeu.concluidas > 0) {
    tituloRanking = "Top 50% Mais Produtivos";
  }

  // Meta semanal (25 OS por padrão na semana, ou 100 no mês)
  const meta = periodo === "semana" ? 25 : 100;
  const progressoPct = Math.min(100, Math.round((dadosMeu.concluidas / meta) * 100));

  // Insígnias gamificadas
  const insignias = [
    {
      id: "lider",
      nome: "Líder da Equipe",
      descricao: "Alcançou o 1º lugar de produtividade da semana",
      icone: "crown",
      desbloqueada: posicao === 1 && dadosMeu.concluidas > 0,
    },
    {
      id: "podio",
      nome: "Pódio de Produtividade",
      descricao: "Ficou entre os 3 técnicos mais ágeis da operação",
      icone: "medal",
      desbloqueada: posicao <= 3 && dadosMeu.concluidas > 0,
    },
    {
      id: "nota_10",
      nome: "Atendimento Nota 10",
      descricao: "Manteve nota média de clientes de 4.8 ou superior",
      icone: "star",
      desbloqueada: notaMediaMeu >= 4.8,
    },
    {
      id: "agilidade",
      nome: "Agilidade Ninja",
      descricao: "Tempo médio de atendimento inferior a 45 minutos",
      icone: "zap",
      desbloqueada: tempoMedioMeu > 0 && tempoMedioMeu <= 45,
    },
    {
      id: "meta_batida",
      nome: "Meta Alcançada",
      descricao: `Atingiu a meta de ${meta} O.S. no período`,
      icone: "target",
      desbloqueada: dadosMeu.concluidas >= meta,
    },
  ];

  return {
    periodo,
    inicioPeriodo: de.toISOString().slice(0, 10),
    fimPeriodo: ate.toISOString().slice(0, 10),
    ranking: {
      posicao,
      totalTecnicos,
      titulo: tituloRanking,
      diferencaParaLider,
    },
    pessoal: {
      osConcluidas: dadosMeu.concluidas,
      osConcluidasSemana: periodo === "semana" ? dadosMeu.concluidas : dadosMeu.concluidas,
      osConcluidasMes: concluidasMesMeu,
      tempoMedioMinutos: tempoMedioMeu,
      notaMedia: notaMediaMeu,
      totalAvaliacoes: dadosMeu.notas.length,
      metaSemanal: meta,
      progressoMetaPct: progressoPct,
    },
    benchmarksEquipe: {
      liderOs,
      mediaEquipeOs,
      tempoMedioEquipeMin,
    },
    insignias,
  };
}
