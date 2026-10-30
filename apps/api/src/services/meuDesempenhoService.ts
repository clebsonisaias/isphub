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
    liderPontos: number;
  };
  pessoal: {
    pontos: number;
    osIndividual: number;
    osDupla: number;
    osConcluidas: number;
    osConcluidasSemana: number;
    osConcluidasMes: number;
    pontosSemana: number;
    pontosMes: number;
    tempoMedioMinutos: number;
    notaMedia: number;
    totalAvaliacoes: number;
    metaSemanal: number;
    progressoMetaPct: number;
  };
  benchmarksEquipe: {
    liderPontos: number;
    liderOs: number;
    mediaEquipePontos: number;
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
    // Primeiro dia do mês atual às 00:00:00
    const de = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
    return { de, ate };
  }

  // Segunda-feira da semana atual às 00:00:00
  const diaSemana = agora.getDay(); // 0 = Domingo, 1 = Segunda, ...
  const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const de = new Date(agora);
  de.setDate(agora.getDate() + diffSegunda);
  de.setHours(0, 0, 0, 0);

  return { de, ate };
}

interface MetricasTecnicoInterna {
  tecnicoId: string;
  nome: string;
  pontos: number;
  osIndividual: number;
  osDupla: number;
  totalOs: number;
  duracoesMin: number[];
  notas: number[];
}

export async function calcularMeuDesempenho(
  usuarioId: string,
  provedorId?: string | null,
  periodo: "semana" | "mes" = "semana",
): Promise<MeuDesempenhoDto> {
  const { de, ate } = obterIntervalo(periodo);

  // Intervalo do mês atual
  const agora = new Date();
  const deMes = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
  const diaSemana = agora.getDay();
  const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const deSemana = new Date(agora);
  deSemana.setDate(agora.getDate() + diffSegunda);
  deSemana.setHours(0, 0, 0, 0);

  // Escopo de provedor para ordens e técnicos
  const escopoProvedor = provedorId ? { provedorId } : {};

  // 1. Busca todos os técnicos ativos da equipe
  const tecnicos = await prisma.usuario.findMany({
    where: {
      role: UserRole.tecnico,
      ativo: true,
      ...(provedorId ? { OR: [{ provedorId }, { provedorId: null }] } : {}),
    },
    select: { id: true, nome: true, nomeExibicao: true },
  });

  const idsTecnicos = tecnicos.map((t) => t.id);
  if (!idsTecnicos.includes(usuarioId)) {
    // Se o usuário logado for admin ou não estiver listado, inclui para cálculo pessoal
    const usuarioLogado = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, nome: true, nomeExibicao: true },
    });
    if (usuarioLogado) {
      tecnicos.push(usuarioLogado);
      idsTecnicos.push(usuarioId);
    }
  }

  // 2. Tabela De-Para SGP -> ISPhub (tecnicos_sgp)
  const vinculosSgp = await prisma.tecnicoSgp.findMany({
    where: {
      papel: "tecnico",
      usuarioId: { not: null },
      ...escopoProvedor,
    },
    select: { sgpId: true, nome: true, username: true, usuarioId: true },
  });

  const porLoginSgp = new Map<string, string>();
  for (const v of vinculosSgp) {
    if (v.usuarioId) {
      if (v.username) porLoginSgp.set(v.username.trim().toLowerCase(), v.usuarioId);
      if (v.nome) porLoginSgp.set(v.nome.trim().toLowerCase(), v.usuarioId);
      if (v.sgpId) porLoginSgp.set(v.sgpId.trim().toLowerCase(), v.usuarioId);
    }
  }

  // 3. Busca ordens de serviço concluídas no período
  // Usamos a data mais antiga necessária (se periodo == 'semana', deSemana; se 'mes', deMes)
  const dataMaisAntiga = de.getTime() < deMes.getTime() ? de : deMes;

  const concluidasTodas = await prisma.ordemServico.findMany({
    where: {
      status: OsStatus.concluida,
      OR: [
        { eventos: { some: { statusPara: OsStatus.concluida, criadoEm: { gte: dataMaisAntiga, lte: ate } } } },
        { statusAlteradoEm: { gte: dataMaisAntiga, lte: ate } },
        { criadoEm: { gte: dataMaisAntiga, lte: ate } },
      ],
      ...escopoProvedor,
    },
    select: {
      id: true,
      tecnicoId: true,
      tecnicoSgpNome: true,
      tecnicosAuxiliaresSgp: true,
      statusAlteradoEm: true,
      criadoEm: true,
      avaliacaoNota: true,
      apoios: { select: { id: true } },
      eventos: {
        where: {
          statusPara: { in: [OsStatus.em_execucao, OsStatus.em_deslocamento, OsStatus.concluida] },
        },
        select: {
          statusPara: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: "asc" },
      },
    },
  });

  // Função auxiliar para pontuar uma lista de OS
  function processarOsParaTecnicos(
    listaOs: typeof concluidasTodas,
    filtroDataGte: Date,
  ): Map<string, MetricasTecnicoInterna> {
    const mapa = new Map<string, MetricasTecnicoInterna>();
    for (const t of tecnicos) {
      mapa.set(t.id, {
        tecnicoId: t.id,
        nome: t.nomeExibicao || t.nome,
        pontos: 0,
        osIndividual: 0,
        osDupla: 0,
        totalOs: 0,
        duracoesMin: [],
        notas: [],
      });
    }

    for (const os of listaOs) {
      // Determina data de conclusão da OS
      const evConclusao = os.eventos.find((e) => e.statusPara === OsStatus.concluida);
      const dataConclusao = evConclusao?.criadoEm ?? os.statusAlteradoEm ?? os.criadoEm;
      if (dataConclusao < filtroDataGte || dataConclusao > ate) {
        continue;
      }

      // 1. Identifica titular (ISPhub ou SGP)
      let titularId = os.tecnicoId;
      if (!titularId && os.tecnicoSgpNome) {
        titularId = porLoginSgp.get(os.tecnicoSgpNome.trim().toLowerCase()) ?? null;
      }

      // 2. Identifica apoios/duplas
      const duplasIds = new Set<string>();
      for (const a of os.apoios) {
        if (a.id !== titularId) {
          duplasIds.add(a.id);
        }
      }
      for (const login of os.tecnicosAuxiliaresSgp || []) {
        const uid = porLoginSgp.get(login.trim().toLowerCase());
        if (uid && uid !== titularId) {
          duplasIds.add(uid);
        }
      }

      const ehDupla = duplasIds.size > 0;

      // Duração de execução
      let duracaoMin: number | null = null;
      const evInicio = os.eventos.find(
        (e) => e.statusPara === OsStatus.em_execucao || e.statusPara === OsStatus.em_deslocamento,
      );
      if (evInicio && evConclusao) {
        const m = Math.round((evConclusao.criadoEm.getTime() - evInicio.criadoEm.getTime()) / 60_000);
        if (m > 5 && m < 480) {
          duracaoMin = m;
        }
      }

      // Pontuação:
      // - Solo: titular ganha 1,0 ponto
      // - Dupla: titular ganha 0,5 ponto e cada integrante do apoio ganha 0,5 ponto
      if (titularId && mapa.has(titularId)) {
        const reg = mapa.get(titularId)!;
        if (ehDupla) {
          reg.pontos += 0.5;
          reg.osDupla += 1;
        } else {
          reg.pontos += 1.0;
          reg.osIndividual += 1;
        }
        reg.totalOs += 1;
        if (os.avaliacaoNota && os.avaliacaoNota >= 1 && os.avaliacaoNota <= 5) {
          reg.notas.push(os.avaliacaoNota);
        }
        if (duracaoMin) {
          reg.duracoesMin.push(duracaoMin);
        }
      }

      for (const dId of duplasIds) {
        const reg = mapa.get(dId);
        if (reg) {
          reg.pontos += 0.5;
          reg.osDupla += 1;
          reg.totalOs += 1;
          if (os.avaliacaoNota && os.avaliacaoNota >= 1 && os.avaliacaoNota <= 5) {
            reg.notas.push(os.avaliacaoNota);
          }
          if (duracaoMin) {
            reg.duracoesMin.push(duracaoMin);
          }
        }
      }
    }

    return mapa;
  }

  // Mapa do período selecionado
  const mapaPeriodo = processarOsParaTecnicos(concluidasTodas, de);

  // Mapa do mês (para métrica consolidada do mês)
  const mapaMes = processarOsParaTecnicos(concluidasTodas, deMes);

  // Mapa da semana (para métrica consolidada da semana)
  const mapaSemana = processarOsParaTecnicos(concluidasTodas, deSemana);

  // 4. Ordena técnicos por pontuação (1º mais pontos, 2º mais OS totais, 3º menor tempo médio)
  const listaOrdenada = Array.from(mapaPeriodo.values()).sort((a, b) => {
    if (b.pontos !== a.pontos) {
      return b.pontos - a.pontos;
    }
    if (b.totalOs !== a.totalOs) {
      return b.totalOs - a.totalOs;
    }
    const mediaA = a.duracoesMin.length ? a.duracoesMin.reduce((acc, v) => acc + v, 0) / a.duracoesMin.length : 999;
    const mediaB = b.duracoesMin.length ? b.duracoesMin.reduce((acc, v) => acc + v, 0) / b.duracoesMin.length : 999;
    return mediaA - mediaB;
  });

  // 5. Encontra a posição individual do técnico logado
  const idx = listaOrdenada.findIndex((t) => t.tecnicoId === usuarioId);
  const posicao = idx >= 0 ? idx + 1 : listaOrdenada.length;
  const totalTecnicos = Math.max(listaOrdenada.length, 1);

  const dadosMeu = mapaPeriodo.get(usuarioId) ?? {
    tecnicoId: usuarioId,
    nome: "Você",
    pontos: 0,
    osIndividual: 0,
    osDupla: 0,
    totalOs: 0,
    duracoesMin: [],
    notas: [],
  };

  const dadosMeuMes = mapaMes.get(usuarioId);
  const dadosMeuSemana = mapaSemana.get(usuarioId);

  const tempoMedioMeu = dadosMeu.duracoesMin.length
    ? Math.round(dadosMeu.duracoesMin.reduce((acc, v) => acc + v, 0) / dadosMeu.duracoesMin.length)
    : 0;

  const notaMediaMeu = dadosMeu.notas.length
    ? Number((dadosMeu.notas.reduce((acc, v) => acc + v, 0) / dadosMeu.notas.length).toFixed(1))
    : 5.0;

  // Benchmarks anônimos da equipe
  const lider = listaOrdenada[0];
  const liderPontos = lider?.pontos ?? 0;
  const liderOs = lider?.totalOs ?? 0;
  const diferencaParaLider = Math.max(0, Number((liderPontos - dadosMeu.pontos).toFixed(1)));

  const totalPontosEquipe = listaOrdenada.reduce((acc, t) => acc + t.pontos, 0);
  const mediaEquipePontos = Number((totalPontosEquipe / totalTecnicos).toFixed(1));

  const totalOsEquipe = listaOrdenada.reduce((acc, t) => acc + t.totalOs, 0);
  const mediaEquipeOs = Math.round(totalOsEquipe / totalTecnicos);

  const todasDuracoes = listaOrdenada.flatMap((t) => t.duracoesMin);
  const tempoMedioEquipeMin = todasDuracoes.length
    ? Math.round(todasDuracoes.reduce((acc, v) => acc + v, 0) / todasDuracoes.length)
    : 45;

  // Título motivacional de acordo com o ranking
  let tituloRanking = "Técnico de Campo";
  if (posicao === 1 && dadosMeu.pontos > 0) {
    tituloRanking = "🥇 Líder Geral da Equipe";
  } else if (posicao === 2 && dadosMeu.pontos > 0) {
    tituloRanking = "🥈 Vice-líder da Semana";
  } else if (posicao === 3 && dadosMeu.pontos > 0) {
    tituloRanking = "🥉 Top 3 da Equipe";
  } else if (posicao <= Math.ceil(totalTecnicos * 0.5) && dadosMeu.pontos > 0) {
    tituloRanking = "Top 50% Mais Produtivos";
  }

  // Meta (25 pontos na semana, ou 100 no mês)
  const meta = periodo === "semana" ? 25 : 100;
  const progressoPct = Math.min(100, Math.round((dadosMeu.pontos / meta) * 100));

  // Insígnias gamificadas
  const insignias = [
    {
      id: "lider",
      nome: "Líder da Equipe",
      descricao: "Alcançou o 1º lugar em pontuação da equipe",
      icone: "crown",
      desbloqueada: posicao === 1 && dadosMeu.pontos > 0,
    },
    {
      id: "podio",
      nome: "Pódio de Produtividade",
      descricao: "Ficou entre os 3 melhores pontuadores",
      icone: "medal",
      desbloqueada: posicao <= 3 && dadosMeu.pontos > 0,
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
      descricao: `Atingiu a meta de ${meta} pontos no período`,
      icone: "target",
      desbloqueada: dadosMeu.pontos >= meta,
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
      liderPontos,
    },
    pessoal: {
      pontos: dadosMeu.pontos,
      osIndividual: dadosMeu.osIndividual,
      osDupla: dadosMeu.osDupla,
      osConcluidas: dadosMeu.totalOs,
      osConcluidasSemana: dadosMeuSemana?.totalOs ?? 0,
      osConcluidasMes: dadosMeuMes?.totalOs ?? 0,
      pontosSemana: dadosMeuSemana?.pontos ?? 0,
      pontosMes: dadosMeuMes?.pontos ?? 0,
      tempoMedioMinutos: tempoMedioMeu,
      notaMedia: notaMediaMeu,
      totalAvaliacoes: dadosMeu.notas.length,
      metaSemanal: meta,
      progressoMetaPct: progressoPct,
    },
    benchmarksEquipe: {
      liderPontos,
      liderOs,
      mediaEquipePontos,
      mediaEquipeOs,
      tempoMedioEquipeMin,
    },
    insignias,
  };
}
