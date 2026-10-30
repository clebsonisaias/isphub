import { TurnoAgenda, haversineMetros, metrosDaOrdem, sugerirOrdem, type ParadaRota } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { emitParaTodos, emitParaUsuario } from "./realtimeHub.js";
import { mapaAoVivo } from "./rastreamentoService.js";

export interface SugestaoRotaTecnicoResultado {
  tecnico: {
    id: string;
    nome: string;
  };
  paradas: {
    agendamentoId: string;
    osId: string | null;
    sgpOsId: string;
    cliente: string | null;
    bairro: string | null;
    categoria: string | null;
    ordemAtual: number | null;
    ordemSugerida: number;
    lat: number | null;
    lng: number | null;
  }[];
  ordemAtualIds: string[];
  ordemSugeridaIds: string[];
  metrosAtual: number;
  metrosSugerido: number;
  kmAtual: number;
  kmSugerido: number;
  kmEconomizado: number;
  minutosEconomizados: number;
  origem: {
    lat: number;
    lng: number;
    tipo: "veiculo_gps" | "celular_evento" | "base_empresa" | "primeira_parada";
    descricao: string;
  } | null;
}

export interface TecnicoProximoResultado {
  id: string;
  nome: string;
  status: "disponivel" | "em_deslocamento" | "em_atendimento";
  statusRotulo: string;
  osAtualId: string | null;
  osAtualSgpId: string | null;
  veiculo: {
    id: string;
    rotulo: string;
    placa: string | null;
  } | null;
  posicao: {
    lat: number;
    lng: number;
    origem: "veiculo_gps" | "celular_evento" | "os_em_andamento" | "base_empresa";
    atualizadoEm: string;
  } | null;
  distanciaMetros: number | null;
  distanciaKm: number | null;
  minutosEstimados: number | null;
  paradasHoje: number;
}

/**
 * Calcula a rota ótima para as paradas de um técnico no dia/turno
 * utilizando heurística TSP (Nearest Neighbor + 2-opt).
 */
export async function obterSugestaoRotaTecnico(
  tecnicoId: string,
  dia: string,
  turno?: TurnoAgenda | "dia_inteiro",
): Promise<SugestaoRotaTecnicoResultado> {
  const tecnico = await prisma.usuario.findUnique({
    where: { id: tecnicoId },
    select: { id: true, nome: true, nomeExibicao: true, provedorId: true },
  });

  if (!tecnico) {
    throw new Error("Técnico não encontrado");
  }

  const condTurno = !turno || turno === "dia_inteiro" ? {} : { turno };

  // Busca agendamentos do técnico no dia
  const agendamentos = await prisma.agendamento.findMany({
    where: {
      dia: new Date(dia),
      ...condTurno,
      status: "marcado",
      ordemServico: {
        tecnicoId: tecnico.id,
      },
    },
    include: {
      ordemServico: {
        select: {
          id: true,
          sgpOsId: true,
          clienteNome: true,
          bairro: true,
          cidade: true,
          lat: true,
          lng: true,
          tipoOs: {
            select: {
              descricao: true,
              categoria: { select: { nome: true } },
            },
          },
        },
      },
    },
    orderBy: [{ ordemRota: { sort: "asc", nulls: "last" } }, { criadoEm: "asc" }],
  });

  // Determina ponto de origem atual do técnico
  let origem: {
    lat: number;
    lng: number;
    tipo: "veiculo_gps" | "celular_evento" | "base_empresa" | "primeira_parada";
    descricao: string;
  } | null = null;

  // 1. Verifica se o técnico está a bordo de viatura com rastreador
  const ocupacaoAtiva = await prisma.ocupacaoVeiculo.findFirst({
    where: { usuarioId: tecnico.id, fimEm: null },
  });

  if (ocupacaoAtiva) {
    const posicoes = await mapaAoVivo();
    const pv = posicoes.find((p) => p.veiculoId === ocupacaoAtiva.veiculoId);
    if (pv) {
      origem = {
        lat: pv.lat,
        lng: pv.lng,
        tipo: "veiculo_gps",
        descricao: `Viatura ${pv.rotulo}`,
      };
    }
  }

  // 2. Se não tem viatura, busca evento de OS recente com GPS do celular
  if (!origem) {
    const eventoRecente = await prisma.osEvento.findFirst({
      where: {
        autorId: tecnico.id,
        lat: { not: null },
        lng: { not: null },
        criadoEm: { gte: new Date(dia) },
      },
      orderBy: { criadoEm: "desc" },
    });

    if (eventoRecente?.lat != null && eventoRecente?.lng != null) {
      origem = {
        lat: eventoRecente.lat,
        lng: eventoRecente.lng,
        tipo: "celular_evento",
        descricao: "Último check-in do técnico no app",
      };
    }
  }

  // 3. Fallback: Base da empresa configurada na Agenda
  if (!origem) {
    const configAgenda = await prisma.agendaConfig.findUnique({
      where: { id: "global" },
    });
    if (configAgenda?.baseLat != null && configAgenda?.baseLng != null) {
      origem = {
        lat: configAgenda.baseLat,
        lng: configAgenda.baseLng,
        tipo: "base_empresa",
        descricao: "Base / Central do provedor",
      };
    }
  }

  // Monta lista de paradas para TSP
  const paradasRota: ParadaRota[] = agendamentos.map((a) => ({
    id: a.id,
    lat: a.ordemServico?.lat ?? null,
    lng: a.ordemServico?.lng ?? null,
  }));

  const origemCoord = origem ? { lat: origem.lat, lng: origem.lng } : null;
  const metrosAtual = metrosDaOrdem(paradasRota, origemCoord);
  const sugestao = sugerirOrdem(paradasRota, origemCoord);
  const metrosSugerido = sugestao.metros;

  const kmAtual = Math.round((metrosAtual / 1000) * 10) / 10;
  const kmSugerido = Math.round((metrosSugerido / 1000) * 10) / 10;
  const metrosEconomizados = Math.max(0, metrosAtual - metrosSugerido);
  const kmEconomizado = Math.round((metrosEconomizados / 1000) * 10) / 10;
  // Estimativa conservadora de 30 km/h em perímetro urbano
  const minutosEconomizados = Math.round((kmEconomizado / 30) * 60);

  // Mapeia posições sugeridas
  const mapaOrdemSugerida = new Map<string, number>();
  sugestao.ordem.forEach((id, idx) => mapaOrdemSugerida.set(id, idx + 1));

  const paradas = agendamentos.map((a) => ({
    agendamentoId: a.id,
    osId: a.ordemServico?.id ?? null,
    sgpOsId: a.sgpOsId,
    cliente: a.ordemServico?.clienteNome ?? null,
    bairro: a.ordemServico?.bairro ?? null,
    categoria: a.ordemServico?.tipoOs?.categoria?.nome ?? a.ordemServico?.tipoOs?.descricao ?? null,
    ordemAtual: a.ordemRota,
    ordemSugerida: mapaOrdemSugerida.get(a.id) ?? (a.ordemRota ?? 1),
    lat: a.ordemServico?.lat ?? null,
    lng: a.ordemServico?.lng ?? null,
  }));

  return {
    tecnico: {
      id: tecnico.id,
      nome: tecnico.nomeExibicao ?? tecnico.nome,
    },
    paradas,
    ordemAtualIds: agendamentos.map((a) => a.id),
    ordemSugeridaIds: sugestao.ordem,
    metrosAtual,
    metrosSugerido,
    kmAtual,
    kmSugerido,
    kmEconomizado,
    minutosEconomizados,
    origem,
  };
}

/**
 * Aplica uma nova ordem das paradas de um técnico (renumera ordemRota).
 */
export async function aplicarOrdemRotaTecnico(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.agendamento.update({
        where: { id },
        data: { ordemRota: index + 1 },
      }),
    ),
  );

  // Emite evento para os apps e despacho atualizarem instantaneamente
  emitParaTodos({
    tipo: "os-alterada",
    osId: ids[0] ?? "",
    em: new Date().toISOString(),
  });
}

/**
 * Encontra técnicos ativos ordenados pela proximidade física em relação a uma O.S. urgente.
 */
export async function obterTecnicosProximos(osId: string): Promise<{
  os: {
    id: string;
    sgpOsId: string;
    clienteNome: string | null;
    bairro: string | null;
    cidade: string | null;
    lat: number | null;
    lng: number | null;
    tipoOs: string | null;
    tecnicoAtual: string | null;
  };
  tecnicos: TecnicoProximoResultado[];
  semCoordenada: boolean;
}> {
  const os = await prisma.ordemServico.findUnique({
    where: { id: osId },
    include: {
      tecnico: { select: { id: true, nome: true, nomeExibicao: true } },
      tipoOs: { select: { descricao: true, categoria: { select: { nome: true } } } },
    },
  });

  if (!os) {
    throw new Error("Ordem de serviço não encontrada");
  }

  const osInfo = {
    id: os.id,
    sgpOsId: os.sgpOsId,
    clienteNome: os.clienteNome,
    bairro: os.bairro,
    cidade: os.cidade,
    lat: os.lat,
    lng: os.lng,
    tipoOs: os.tipoOs?.categoria?.nome ?? os.tipoOs?.descricao ?? null,
    tecnicoAtual: os.tecnico?.nomeExibicao ?? os.tecnico?.nome ?? null,
  };

  if (os.lat == null || os.lng == null) {
    return {
      os: osInfo,
      tecnicos: [],
      semCoordenada: true,
    };
  }

  const osCoord = { lat: os.lat, lng: os.lng };

  // Busca técnicos ativos do provedor
  const tecnicos = await prisma.usuario.findMany({
    where: {
      role: "tecnico",
      ativo: true,
      ...(os.provedorId ? { provedorId: os.provedorId } : {}),
    },
    select: {
      id: true,
      nome: true,
      nomeExibicao: true,
      provedorId: true,
    },
  });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // Busca posições de viaturas ao vivo
  const posicoesVeiculos = await mapaAoVivo();

  const resultados: TecnicoProximoResultado[] = [];

  for (const t of tecnicos) {
    // 1. Ocupação de viatura ativa
    const ocupacao = await prisma.ocupacaoVeiculo.findFirst({
      where: { usuarioId: t.id, fimEm: null },
    });

    const pv = ocupacao ? posicoesVeiculos.find((p) => p.veiculoId === ocupacao.veiculoId) : null;

    // 2. OS em andamento no momento (Em deslocamento ou Em execução)
    const osAndamento = await prisma.ordemServico.findFirst({
      where: {
        tecnicoId: t.id,
        status: { in: ["em_deslocamento", "em_execucao"] },
      },
      select: {
        id: true,
        sgpOsId: true,
        status: true,
        lat: true,
        lng: true,
      },
    });

    // 3. Evento recente com coordenadas do celular
    const eventoRecente = await prisma.osEvento.findFirst({
      where: {
        autorId: t.id,
        lat: { not: null },
        lng: { not: null },
        criadoEm: { gte: hoje },
      },
      orderBy: { criadoEm: "desc" },
    });

    // 4. Paradas marcadas hoje
    const paradasHoje = await prisma.agendamento.count({
      where: {
        dia: hoje,
        status: "marcado",
        ordemServico: { tecnicoId: t.id },
      },
    });

    // Determina a melhor posição disponível
    let pos: TecnicoProximoResultado["posicao"] = null;

    if (pv) {
      pos = {
        lat: pv.lat,
        lng: pv.lng,
        origem: "veiculo_gps",
        atualizadoEm: pv.registradoEm,
      };
    } else if (eventoRecente?.lat != null && eventoRecente?.lng != null) {
      pos = {
        lat: eventoRecente.lat,
        lng: eventoRecente.lng,
        origem: "celular_evento",
        atualizadoEm: eventoRecente.criadoEm.toISOString(),
      };
    } else if (osAndamento?.lat != null && osAndamento?.lng != null) {
      pos = {
        lat: osAndamento.lat,
        lng: osAndamento.lng,
        origem: "os_em_andamento",
        atualizadoEm: new Date().toISOString(),
      };
    }

    // Calcula distância até a OS de emergência
    let distanciaMetros: number | null = null;
    let distanciaKm: number | null = null;
    let minutosEstimados: number | null = null;

    if (pos) {
      distanciaMetros = Math.round(haversineMetros(pos, osCoord));
      distanciaKm = Math.round((distanciaMetros / 1000) * 10) / 10;
      minutosEstimados = Math.max(1, Math.round((distanciaKm / 30) * 60));
    }

    let status: TecnicoProximoResultado["status"] = "disponivel";
    let statusRotulo = "Disponível";
    if (osAndamento?.status === "em_deslocamento") {
      status = "em_deslocamento";
      statusRotulo = `A caminho da OS ${osAndamento.sgpOsId}`;
    } else if (osAndamento?.status === "em_execucao") {
      status = "em_atendimento";
      statusRotulo = `Em atendimento na OS ${osAndamento.sgpOsId}`;
    }

    resultados.push({
      id: t.id,
      nome: t.nomeExibicao ?? t.nome,
      status,
      statusRotulo,
      osAtualId: osAndamento?.id ?? null,
      osAtualSgpId: osAndamento?.sgpOsId ?? null,
      veiculo: pv
        ? {
            id: pv.veiculoId,
            rotulo: pv.rotulo,
            placa: pv.placa,
          }
        : null,
      posicao: pos,
      distanciaMetros,
      distanciaKm,
      minutosEstimados,
      paradasHoje,
    });
  }

  // Ordena os técnicos por proximidade física (mais próximos primeiro)
  resultados.sort((a, b) => {
    if (a.distanciaMetros != null && b.distanciaMetros != null) {
      return a.distanciaMetros - b.distanciaMetros;
    }
    if (a.distanciaMetros != null) return -1;
    if (b.distanciaMetros != null) return 1;
    return a.paradasHoje - b.paradasHoje;
  });

  return {
    os: osInfo,
    tecnicos: resultados,
    semCoordenada: false,
  };
}

/**
 * Realiza o despacho emergencial de uma O.S. para um técnico com prioridade máxima.
 */
export async function despacharEmergencial(
  osId: string,
  tecnicoId: string,
  options: {
    encaixarPrimeiro?: boolean;
    turno?: TurnoAgenda;
    usuarioAutorId?: string;
  },
): Promise<{ ok: boolean; mensagem: string }> {
  const os = await prisma.ordemServico.findUnique({
    where: { id: osId },
    include: { tecnico: true },
  });

  if (!os) {
    throw new Error("Ordem de serviço não encontrada");
  }

  const tecnico = await prisma.usuario.findUnique({
    where: { id: tecnicoId },
    select: { id: true, nome: true, nomeExibicao: true },
  });

  if (!tecnico) {
    throw new Error("Técnico destinatário não encontrado");
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const horaAtual = new Date().getHours();
  const turnoPadrao: TurnoAgenda = options.turno ?? (horaAtual < 12 ? "manha" : "tarde");

  // Transação: Atribui a OS, gerencia a rota e cria o evento de auditoria
  await prisma.$transaction(async (tx) => {
    // 1. Atualiza a O.S. com o técnico
    await tx.ordemServico.update({
      where: { id: osId },
      data: {
        tecnicoId: tecnico.id,
      },
    });

    // 2. Se for encaixar como 1ª parada, desloca as demais paradas do turno
    if (options.encaixarPrimeiro !== false) {
      const paradasDoTurno = await tx.agendamento.findMany({
        where: {
          dia: hoje,
          turno: turnoPadrao,
          status: "marcado",
          ordemServico: { tecnicoId: tecnico.id },
        },
        orderBy: [{ ordemRota: { sort: "asc", nulls: "last" } }],
      });

      // Incrementa ordem das existentes
      for (const p of paradasDoTurno) {
        if (p.ordemServicoId !== osId) {
          await tx.agendamento.update({
            where: { id: p.id },
            data: { ordemRota: (p.ordemRota ?? 1) + 1 },
          });
        }
      }
    }

    // 3. Cria ou atualiza o agendamento da O.S. urgente
    const agExistente = await tx.agendamento.findFirst({
      where: { ordemServicoId: osId, status: "marcado" },
    });

    if (agExistente) {
      await tx.agendamento.update({
        where: { id: agExistente.id },
        data: {
          dia: hoje,
          turno: turnoPadrao,
          ordemRota: options.encaixarPrimeiro !== false ? 1 : undefined,
        },
      });
    } else {
      await tx.agendamento.create({
        data: {
          provedorId: os.provedorId,
          sgpOsId: os.sgpOsId,
          ordemServicoId: os.id,
          dia: hoje,
          turno: turnoPadrao,
          ordemRota: 1,
          status: "marcado",
          origem: "manual",
        },
      });
    }

    // 4. Registra evento de auditoria na O.S.
    await tx.osEvento.create({
      data: {
        ordemServicoId: os.id,
        tipo: "atribuicao",
        autorId: options.usuarioAutorId ?? null,
        descricao: `🚨 Despacho emergencial por proximidade física atribuído a ${tecnico.nomeExibicao ?? tecnico.nome} (1ª parada prioritária)`,
      },
    });
  });

  // Emite alerta em tempo real para a equipe e diretamente para o técnico
  const nomeTecnico = tecnico.nomeExibicao ?? tecnico.nome;
  emitParaTodos({
    tipo: "os-alterada",
    osId: os.id,
    em: new Date().toISOString(),
  });
  emitParaUsuario(tecnico.id, {
    tipo: "os-alterada",
    osId: os.id,
    em: new Date().toISOString(),
  });

  return {
    ok: true,
    mensagem: `OS ${os.sgpOsId} despachada com sucesso para ${nomeTecnico} como 1ª parada prioritária!`,
  };
}
