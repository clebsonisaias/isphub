import { planejarRedistribuicao, type TurnoAgenda } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { dataDoDia, lerConfig } from "./agendaService.js";
import { atribuirTecnico } from "./writebackService.js";

/**
 * Quem faltou tinha paradas; alguem precisa fazer. Propoe e aplica a
 * redistribuicao entre os escalados do turno. Proposta e aplicacao separadas:
 * o supervisor ve e muda antes de valer.
 */
export interface PropostaRedistribuicao {
  paradas: {
    agendamentoId: string;
    ordemServicoId: string;
    sgpOsId: string;
    clienteNome: string | null;
    regiao: string | null;
    tecnicoSugeridoId: string | null;
  }[];
  candidatos: { tecnicoId: string; nome: string; carga: number }[];
  tetoPorTecnico: number | null;
  semDestino: string[];
}

export async function propostaRedistribuicao(dia: string, turno: TurnoAgenda, usuarioId: string): Promise<PropostaRedistribuicao> {
  const [config, marcadas, escalados] = await Promise.all([
    lerConfig(),
    prisma.agendamento.findMany({
      where: { dia: dataDoDia(dia), turno, status: "marcado", ordemServicoId: { not: null } },
      select: {
        id: true,
        sgpOsId: true,
        regiao: true,
        ordemServico: { select: { id: true, tecnicoId: true, clienteNome: true, status: true } },
      },
    }),
    prisma.escalaJornada.findMany({
      where: { dia: dataDoDia(dia), turnos: { has: turno }, ausenteEm: null, usuarioId: { not: usuarioId }, usuario: { ativo: true, role: "tecnico" } },
      select: { usuario: { select: { id: true, nome: true, nomeExibicao: true } } },
    }),
  ]);

  // So OS ainda abertas: concluida nao precisa de outro tecnico.
  const doAusente = marcadas.filter((m) => m.ordemServico?.tecnicoId === usuarioId && m.ordemServico.status !== "concluida" && m.ordemServico.status !== "cancelada");
  const candidatos = escalados.map((e) => ({
    tecnicoId: e.usuario.id,
    nome: e.usuario.nomeExibicao || e.usuario.nome,
    carga: marcadas.filter((m) => m.ordemServico?.tecnicoId === e.usuario.id).length,
  }));

  const plano = planejarRedistribuicao({
    paradas: doAusente.map((m) => m.id),
    candidatos,
    tetoPorTecnico: config.vagasPorTecnico,
  });
  const destino = new Map(plano.atribuicoes.map((a) => [a.agendamentoId, a.tecnicoId]));

  return {
    paradas: doAusente.map((m) => ({
      agendamentoId: m.id,
      ordemServicoId: m.ordemServico!.id,
      sgpOsId: m.sgpOsId,
      clienteNome: m.ordemServico!.clienteNome,
      regiao: m.regiao,
      tecnicoSugeridoId: destino.get(m.id) ?? null,
    })),
    candidatos,
    tetoPorTecnico: config.vagasPorTecnico,
    semDestino: plano.semDestino,
  };
}

/** Aplica o que o supervisor aprovou. Cada parada troca de tecnico e perde a posicao na rota antiga. */
export async function aplicarRedistribuicao(itens: { agendamentoId: string; tecnicoId: string }[], autorId: string): Promise<number> {
  let aplicadas = 0;
  for (const item of itens) {
    const a = await prisma.agendamento.findUnique({ where: { id: item.agendamentoId }, select: { ordemServicoId: true, status: true } });
    if (!a?.ordemServicoId || a.status !== "marcado") throw new HttpError(409, "Marcacao sem OS espelhada ou ja cancelada");
    await atribuirTecnico(a.ordemServicoId, item.tecnicoId, autorId);
    await prisma.agendamento.update({ where: { id: item.agendamentoId }, data: { ordemRota: null } });
    aplicadas += 1;
  }
  return aplicadas;
}
