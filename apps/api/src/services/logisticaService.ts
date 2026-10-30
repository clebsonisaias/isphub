import { TurnoAgenda, haversineMetros, metrosDaOrdem, sugerirOrdem, type ParadaRota, diaBrHoje } from "@isphub/shared";
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

export interface MinhaRotaDoDiaParada {
  agendamentoId: string;
  osId: string;
  sgpOsId: string;
  cliente: string | null;
  bairro: string | null;
  cidade: string | null;
  logradouro: string | null;
  numero: string | null;
  enderecoFormatado: string;
  horarioPrevisto: string;
  turno: "manha" | "tarde";
  ordem: number;
  status: string;
  lat: number | null;
  lng: number | null;
  distanciaTrechoKm: number | null;
  distanciaAcumuladaKm: number | null;
}

export interface MinhaRotaDoDiaResultado {
  dia: string;
  diaFormatado: string;
  totalParadas: number;
  totalKm: number;
  tempoEstimadoMinutos: number;
  origem: {
    lat: number;
    lng: number;
    descricao: string;
  } | null;
  paradas: MinhaRotaDoDiaParada[];
  googleMapsUrl: string | null;
}

export function gerarGoogleMapsUrl(
  origem: { lat: number; lng: number } | null,
  paradas: { lat: number; lng: number }[],
): string | null {
  if (paradas.length === 0) return null;

  if (paradas.length === 1 && !origem) {
    const p = paradas[0];
    return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
  }

  const pontoOrigem = origem ? `${origem.lat},${origem.lng}` : `${paradas[0].lat},${paradas[0].lng}`;
  const pontoDestino = `${paradas[paradas.length - 1].lat},${paradas[paradas.length - 1].lng}`;

  const paradasIntermediarias = origem ? paradas.slice(0, -1) : paradas.slice(1, -1);

  const waypoints = paradasIntermediarias.map((p) => `${p.lat},${p.lng}`).join("|");
  const waypointsParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";

  return `https://www.google.com/maps/dir/?api=1&origin=${pontoOrigem}&destination=${pontoDestino}${waypointsParam}&travelmode=driving`;
}

/**
 * Consulta a rota do dia do técnico logado com as paradas na sequência ótima,
 * cálculo de distâncias entre cada ponto e link multi-paradas para o Google Maps.
 */
export async function obterMinhaRotaDoDia(
  tecnicoId: string,
  diaStr?: string,
): Promise<MinhaRotaDoDiaResultado> {
  const dia = diaStr || diaBrHoje();
  const diaDate = new Date(dia);

  // Busca agendamentos do técnico no dia (titular ou apoio)
  let agendamentos = await prisma.agendamento.findMany({
    where: {
      dia: diaDate,
      status: "marcado",
      ordemServico: {
        OR: [{ tecnicoId }, { apoios: { some: { id: tecnicoId } } }],
      },
    },
    include: {
      ordemServico: {
        include: {
          tipoOs: {
            include: { categoria: true },
          },
        },
      },
    },
    orderBy: [
      { ordemRota: { sort: "asc", nulls: "last" } },
      { turno: "asc" },
      { criadoEm: "asc" },
    ],
  });

  // Se tiver 2 ou mais paradas agendadas e alguma ainda não tiver ordemRota definida,
  // chama o robô de roteirização para ordenar e persistir na agenda
  const precisaRoteirizar = agendamentos.length >= 2 && agendamentos.some((a) => a.ordemRota == null);
  if (precisaRoteirizar) {
    try {
      const sugestao = await obterSugestaoRotaTecnico(tecnicoId, dia, "dia_inteiro");
      if (sugestao.ordemSugeridaIds.length) {
        await aplicarOrdemRotaTecnico(sugestao.ordemSugeridaIds);
        agendamentos = await prisma.agendamento.findMany({
          where: {
            id: { in: sugestao.ordemSugeridaIds },
          },
          include: {
            ordemServico: {
              include: {
                tipoOs: {
                  include: { categoria: true },
                },
              },
            },
          },
          orderBy: [{ ordemRota: "asc" }],
        });
      }
    } catch (e) {
      console.warn("[obterMinhaRotaDoDia] Falha na auto-roteirização:", e);
    }
  }

  // Busca também as O.S. abertas da fila ativa do técnico que ainda não estejam na tabela de agendamentos de hoje
  const idsOsJaAgendadas = new Set(agendamentos.map((a) => a.ordemServicoId).filter(Boolean) as string[]);
  const osAbertasDaFila = await prisma.ordemServico.findMany({
    where: {
      status: { in: ["aberta", "em_deslocamento", "em_execucao"] },
      OR: [{ tecnicoId }, { apoios: { some: { id: tecnicoId } } }],
      ...(idsOsJaAgendadas.size > 0 ? { id: { notIn: [...idsOsJaAgendadas] } } : {}),
    },
    include: {
      tipoOs: {
        include: { categoria: true },
      },
    },
    orderBy: [{ dataAgendamento: "asc" }, { criadoEm: "asc" }],
  });

  // Determina localização de origem (GPS da viatura ou último check-in do técnico)
  let origem: { lat: number; lng: number; descricao: string } | null = null;
  const ocupacaoAtiva = await prisma.ocupacaoVeiculo.findFirst({
    where: { usuarioId: tecnicoId, fimEm: null },
  });
  if (ocupacaoAtiva) {
    const posicoes = await mapaAoVivo();
    const pv = posicoes.find((p) => p.veiculoId === ocupacaoAtiva.veiculoId);
    if (pv) {
      origem = { lat: pv.lat, lng: pv.lng, descricao: `Viatura ${pv.rotulo}` };
    }
  }

  // Fallback: Base da empresa configurada na Agenda
  if (!origem) {
    const configAgenda = await prisma.agendaConfig.findUnique({
      where: { id: "global" },
    });
    if (configAgenda?.baseLat != null && configAgenda?.baseLng != null) {
      origem = {
        lat: configAgenda.baseLat,
        lng: configAgenda.baseLng,
        descricao: "Base / Central do provedor",
      };
    }
  }

  // Unifica paradas agendadas + O.S. abertas da fila do técnico
  type ItemBrutoRota = {
    itemId: string;
    os: (typeof osAbertasDaFila)[number];
    turno: "manha" | "tarde";
    ordemFixa: number | null;
  };

  const itensRota: ItemBrutoRota[] = [
    ...agendamentos
      .filter((a) => a.ordemServico != null)
      .map((a) => ({
        itemId: a.id,
        os: a.ordemServico!,
        turno: (a.turno === "tarde" ? "tarde" : "manha") as "manha" | "tarde",
        ordemFixa: a.ordemRota,
      })),
    ...osAbertasDaFila.map((os) => ({
      itemId: os.id,
      os,
      turno: (os.dataAgendamento && os.dataAgendamento.getHours() >= 13 ? "tarde" : "manha") as "manha" | "tarde",
      ordemFixa: null,
    })),
  ];

  // Se houver itens sem ordemFixa (ex: vindos direto da fila do técnico),
  // aplica o robô TSP 2-opt (sugerirOrdem) para deixá-los na melhor sequência geográfica
  if (itensRota.length >= 2 && itensRota.some((it) => it.ordemFixa == null)) {
    const sugestaoFila = sugerirOrdem(
      itensRota.map((it) => ({
        id: it.itemId,
        lat: it.os.lat ?? null,
        lng: it.os.lng ?? null,
      })),
      origem ? { lat: origem.lat, lng: origem.lng } : null,
    );
    const mapaIdx = new Map<string, number>();
    sugestaoFila.ordem.forEach((id, idx) => mapaIdx.set(id, idx));
    itensRota.sort((a, b) => (mapaIdx.get(a.itemId) ?? 999) - (mapaIdx.get(b.itemId) ?? 999));
  }

  // Calcula distâncias e formata as paradas
  let pontoAnterior = origem;
  let totalMetros = 0;

  const paradas: MinhaRotaDoDiaParada[] = [];

  for (let i = 0; i < itensRota.length; i++) {
    const item = itensRota[i];
    const os = item.os;
    const lat = os.lat ?? null;
    const lng = os.lng ?? null;

    let distanciaTrechoKm: number | null = null;
    if (lat != null && lng != null && pontoAnterior) {
      const dMetros = haversineMetros(pontoAnterior, { lat, lng });
      distanciaTrechoKm = Number((dMetros / 1000).toFixed(1));
      totalMetros += dMetros;
      pontoAnterior = { lat, lng, descricao: `Parada ${i + 1}` };
    } else if (lat != null && lng != null) {
      pontoAnterior = { lat, lng, descricao: `Parada ${i + 1}` };
    }

    const rua = [os.logradouro, os.numero].filter(Boolean).join(", ");
    const enderecoFormatado = rua
      ? `${rua}${os.bairro ? ` - ${os.bairro}` : ""}${os.cidade ? `, ${os.cidade}` : ""}`
      : os.cidade
        ? os.cidade
        : os.pop
          ? `POP ${os.pop}`
          : "Endereço não informado";

    const horarioPrevisto = item.turno === "manha" ? "08:00 - 12:00" : "13:00 - 18:00";

    paradas.push({
      agendamentoId: item.itemId,
      osId: os.id,
      sgpOsId: os.sgpOsId,
      cliente: os.clienteNome ?? "Cliente",
      bairro: os.bairro,
      cidade: os.cidade,
      logradouro: os.logradouro,
      numero: os.numero,
      enderecoFormatado,
      horarioPrevisto,
      turno: item.turno,
      ordem: i + 1,
      status: os.status,
      lat,
      lng,
      distanciaTrechoKm,
      distanciaAcumuladaKm: Number((totalMetros / 1000).toFixed(1)),
    });
  }

  // Google Maps URL
  const paradasComGeo = paradas.filter(
    (p): p is MinhaRotaDoDiaParada & { lat: number; lng: number } => p.lat != null && p.lng != null,
  );
  const googleMapsUrl = gerarGoogleMapsUrl(origem, paradasComGeo);

  // Formatação do dia
  const dObj = new Date(dia + "T12:00:00");
  const mesExtenso = dObj.toLocaleDateString("pt-BR", { month: "long" });
  const diaNum = dObj.getDate();
  const diaFormatado = `Hoje, ${diaNum} de ${mesExtenso}`;

  const totalKm = Number((totalMetros / 1000).toFixed(1));
  const tempoEstimadoMinutos = Math.round((totalKm / 35) * 60) + paradas.length * 20;

  return {
    dia,
    diaFormatado,
    totalParadas: paradas.length,
    totalKm,
    tempoEstimadoMinutos,
    origem,
    paradas,
    googleMapsUrl,
  };
}

/**
 * Robô de Roteirização Automática:
 * Varre todos os técnicos com OS marcadas para o dia e calcula a rota ótima (TSP 2-opt).
 * Custo de tokens: R$ 0,00 (100% determinístico e executado em memória).
 */
export async function otimizarTodasRotasDoDia(
  diaStr?: string,
  provedorId?: string | null,
): Promise<{
  ok: boolean;
  dia: string;
  tecnicosOtimizados: number;
  totalParadas: number;
  kmTotalEconomizado: number;
}> {
  const dia = diaStr || diaBrHoje();
  const diaDate = new Date(dia);

  const agendamentos = await prisma.agendamento.findMany({
    where: {
      dia: diaDate,
      status: "marcado",
      ordemServico: {
        tecnicoId: { not: null },
        ...(provedorId ? { provedorId } : {}),
      },
    },
    select: {
      id: true,
      ordemServico: {
        select: {
          tecnicoId: true,
        },
      },
    },
  });

  const idsTecnicos = [...new Set(agendamentos.map((a) => a.ordemServico?.tecnicoId).filter(Boolean))] as string[];

  let tecnicosOtimizados = 0;
  let totalParadas = 0;
  let kmTotalEconomizado = 0;

  for (const tId of idsTecnicos) {
    try {
      const sugestao = await obterSugestaoRotaTecnico(tId, dia, "dia_inteiro");
      if (sugestao.paradas.length >= 2) {
        await aplicarOrdemRotaTecnico(sugestao.ordemSugeridaIds);
        tecnicosOtimizados += 1;
        totalParadas += sugestao.paradas.length;
        kmTotalEconomizado += sugestao.kmEconomizado;
      }
    } catch (err) {
      console.warn(`[Robô Roteirizador] Falha ao otimizar técnico ${tId}:`, err);
    }
  }

  // Notifica todos via WebSocket
  emitParaTodos({
    tipo: "os-alterada",
    em: new Date().toISOString(),
  });

  return {
    ok: true,
    dia,
    tecnicosOtimizados,
    totalParadas,
    kmTotalEconomizado: Number(kmTotalEconomizado.toFixed(1)),
  };
}
