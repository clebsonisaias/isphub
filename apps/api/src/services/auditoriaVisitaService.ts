import { Prisma } from "@prisma/client";
import { UserRole, densidadeSuficiente, vereditoPresenca, type VereditoPresenca } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { densificar, posicoesEntre, rastreadorDoVeiculoEm } from "./deslocamentoService.js";
import { janelaExecucao, veiculosDaOs } from "./ocupacaoService.js";

/**
 * VISITA FANTASMA — OS concluida sem a viatura ter passado pelo endereco.
 *
 * Janela alargada em 30 min pra cada lado (o tecnico pode fechar no carro, a
 * caminho da proxima). Raio de 300 m: geocodigo de endereco erra quadra.
 * Tres vereditos, e `sem_dados` NUNCA alerta: sem posicao, sem endereco, sem
 * veiculo ou sem janela de execucao (OS fechada direto no SGP), nao da pra
 * afirmar nada — e acusar sem prova e pior que nao auditar.
 */
export const RAIO_PRESENCA_M = 300;
const FOLGA_MS = 30 * 60_000;

const SELECT = {
  ordemServicoId: true,
  veiculoId: true,
  veredito: true,
  distanciaMinMetros: true,
  posicoes: true,
  inicioEm: true,
  fimEm: true,
  auditadaEm: true,
} satisfies Prisma.AuditoriaVisitaSelect;

export interface AuditoriaPublic {
  ordemServicoId: string;
  veiculoId: string | null;
  veredito: VereditoPresenca;
  distanciaMinMetros: number | null;
  posicoes: number;
  inicioEm: string;
  fimEm: string;
  auditadaEm: string;
}

function serializar(a: Prisma.AuditoriaVisitaGetPayload<{ select: typeof SELECT }>): AuditoriaPublic {
  return {
    ...a,
    veredito: a.veredito as VereditoPresenca,
    inicioEm: a.inicioEm.toISOString(),
    fimEm: a.fimEm.toISOString(),
    auditadaEm: a.auditadaEm.toISOString(),
  };
}

export async function auditoriaDaOs(ordemServicoId: string): Promise<AuditoriaPublic | null> {
  const a = await prisma.auditoriaVisita.findUnique({ where: { ordemServicoId }, select: SELECT });
  return a ? serializar(a) : null;
}

export async function auditarOs(ordemServicoId: string): Promise<AuditoriaPublic | null> {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId }, select: { id: true, lat: true, lng: true, status: true } });
  if (!os || os.status !== "concluida") return null;
  const janela = await janelaExecucao(ordemServicoId);
  const agora = new Date();
  const de = janela ? new Date(janela.inicio.getTime() - FOLGA_MS) : null;
  const ate = janela ? new Date(janela.fim.getTime() + FOLGA_MS) : null;

  let posicoes: { lat: number; lng: number }[] = [];
  let veiculoId: string | null = null;
  if (janela && de && ate) {
    const veiculos = await veiculosDaOs(ordemServicoId);
    veiculoId = veiculos[0]?.ocupacao.veiculoId ?? null;
    const rastreador = veiculoId ? await rastreadorDoVeiculoEm(veiculoId, janela.inicio) : null;
    if (rastreador) {
      posicoes = await posicoesEntre(rastreador.id, de, ate);
      if (!densidadeSuficiente(posicoes.length, de, ate)) {
        if ((await densificar(rastreador, de, ate)) > 0) posicoes = await posicoesEntre(rastreador.id, de, ate);
      }
    }
  }

  const r = vereditoPresenca({
    posicoes,
    endereco: os.lat != null && os.lng != null && janela ? { lat: os.lat, lng: os.lng } : null,
    raioMetros: RAIO_PRESENCA_M,
  });
  const dados = {
    veiculoId,
    veredito: r.veredito,
    distanciaMinMetros: r.distanciaMinMetros,
    posicoes: posicoes.length,
    inicioEm: de ?? agora,
    fimEm: ate ?? agora,
    auditadaEm: agora,
  };
  const a = await prisma.auditoriaVisita.upsert({ where: { ordemServicoId }, create: { ordemServicoId, ...dados }, update: dados, select: SELECT });
  return serializar(a);
}

/** OS concluidas nas ultimas horas ainda sem auditoria. */
export async function pendentesDeAuditoria(horas = 6, limite = 50): Promise<string[]> {
  const desde = new Date(Date.now() - horas * 3_600_000);
  const linhas = await prisma.ordemServico.findMany({
    where: { status: "concluida", statusAlteradoEm: { gte: desde }, auditoriaVisita: null },
    orderBy: { statusAlteradoEm: "asc" },
    take: limite,
    select: { id: true },
  });
  return linhas.map((l) => l.id);
}

/** Avisa os gestores das ausentes ainda nao avisadas (trava por coluna). */
export async function notificarAusentes(): Promise<number> {
  const ausentes = await prisma.auditoriaVisita.findMany({
    where: { veredito: "ausente", notificadaEm: null },
    select: { id: true, distanciaMinMetros: true, ordemServico: { select: { id: true, sgpOsId: true, clienteNome: true } } },
    take: 50,
  });
  if (ausentes.length === 0) return 0;
  const gestores = await prisma.usuario.findMany({ where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true }, select: { id: true } });
  for (const a of ausentes) {
    const quem = a.ordemServico.clienteNome ?? `OS #${a.ordemServico.sgpOsId}`;
    await prisma.$transaction([
      prisma.auditoriaVisita.update({ where: { id: a.id }, data: { notificadaEm: new Date() } }),
      prisma.osEvento.create({
        data: {
          ordemServicoId: a.ordemServico.id,
          tipo: "anotacao",
          autorId: null,
          descricao: `Auditoria: a viatura não passou pelo endereço durante a execução (distância mínima ${a.distanciaMinMetros ?? "?"} m).`,
        },
      }),
      prisma.notificacao.createMany({
        data: gestores.map((g) => ({
          usuarioId: g.id,
          tipo: "visita_sem_presenca",
          mensagem: `Visita sem presença: ${quem} foi concluída sem a viatura passar pelo endereço.`,
          ordemServicoId: a.ordemServico.id,
        })),
      }),
    ]);
  }
  return ausentes.length;
}

/** Contagem pro Dashboard. */
/** `escopoOs`: recorte por provedor da OS (gestor limitado); vazio = todas. */
export async function semPresencaDesde(desde: Date, escopoOs: Record<string, unknown> = {}): Promise<number> {
  return prisma.auditoriaVisita.count({
    where: { veredito: "ausente", auditadaEm: { gte: desde }, ...(Object.keys(escopoOs).length ? { ordemServico: escopoOs } : {}) },
  });
}
