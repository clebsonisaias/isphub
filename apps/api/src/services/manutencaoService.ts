import { UserRole, estadoManutencao, formatarPlaca, type EstadoManutencao, type PlanoManutencaoDto } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * MANUTENCAO PREVENTIVA — o lado "o que fazer com o numero" do odometro.
 *
 * Odometro atual = a MAIOR leitura que temos do carro: o cache do veiculo, o
 * ultimo abastecimento e o ultimo checklist/ocupacao. Nao ha odometro no
 * rastreador (ver sensores.ts), entao e leitura humana — e por isso o
 * checklist da saida pede o km.
 */
export async function odometroAtual(veiculoId: string): Promise<number | null> {
  const [v, ab, oc] = await Promise.all([
    prisma.veiculo.findUnique({ where: { id: veiculoId }, select: { odometroKm: true } }),
    prisma.abastecimento.findFirst({ where: { veiculoId }, orderBy: { data: "desc" }, select: { km: true } }),
    prisma.ocupacaoVeiculo.findFirst({
      where: { veiculoId, OR: [{ odometroFim: { not: null } }, { odometroInicio: { not: null } }] },
      orderBy: { inicioEm: "desc" },
      select: { odometroFim: true, odometroInicio: true },
    }),
  ]);
  const leituras = [v?.odometroKm, ab?.km, oc?.odometroFim, oc?.odometroInicio].filter((n): n is number => n != null);
  return leituras.length ? Math.max(...leituras) : null;
}

export interface PlanoComEstado extends PlanoManutencaoDto {
  estado: EstadoManutencao;
}

function dto(p: { id: string; veiculoId: string; tipo: string; intervaloKm: number | null; intervaloDias: number | null; ultimaKm: number | null; ultimaEm: Date | null; ativo: boolean }): PlanoManutencaoDto {
  return { ...p, ultimaEm: p.ultimaEm ? p.ultimaEm.toISOString() : null };
}

export async function listarPlanos(veiculoId: string): Promise<{ odometroKm: number | null; planos: PlanoComEstado[] }> {
  const [odometroKm, planos] = await Promise.all([
    odometroAtual(veiculoId),
    prisma.planoManutencao.findMany({ where: { veiculoId, ativo: true }, orderBy: { criadoEm: "asc" } }),
  ]);
  return { odometroKm, planos: planos.map((p) => ({ ...dto(p), estado: estadoManutencao(dto(p), odometroKm) })) };
}

export async function criarPlano(args: { veiculoId: string; tipo: string; intervaloKm?: number | null; intervaloDias?: number | null; ultimaKm?: number | null; ultimaEm?: Date | null }) {
  if (args.intervaloKm == null && args.intervaloDias == null) throw new HttpError(400, "Informe o intervalo em km, em dias, ou os dois");
  const v = await prisma.veiculo.findUnique({ where: { id: args.veiculoId }, select: { id: true } });
  if (!v) throw new HttpError(404, "Veiculo nao encontrado");
  return prisma.planoManutencao.create({ data: { ...args, intervaloKm: args.intervaloKm ?? null, intervaloDias: args.intervaloDias ?? null, ultimaKm: args.ultimaKm ?? null, ultimaEm: args.ultimaEm ?? null } });
}

/** "Feita": carimba km e data de agora e libera o sino pra proxima vez. */
export async function concluirPlano(id: string, km?: number | null, registradoPor?: string | null) {
  const p = await prisma.planoManutencao.findUnique({ where: { id }, select: { veiculoId: true, tipo: true } });
  if (!p) throw new HttpError(404, "Plano nao encontrado");
  const atual = km ?? (await odometroAtual(p.veiculoId));
  const em = new Date();
  /*
   * Plano e historico na MESMA transacao: o plano guarda so a ultima vez (pro
   * proximo vencimento), o historico guarda todas. Separados, uma falha no
   * meio deixaria o plano "feito" sem a linha que diz quando.
   */
  const [plano] = await prisma.$transaction([
    prisma.planoManutencao.update({ where: { id }, data: { ultimaKm: atual, ultimaEm: em, avisadoEm: null } }),
    prisma.manutencaoRealizada.create({
      data: { veiculoId: p.veiculoId, planoId: id, tipo: p.tipo, km: atual, em, registradoPor: registradoPor ?? null },
    }),
  ]);
  return plano;
}

export async function removerPlano(id: string) {
  await prisma.planoManutencao.updateMany({ where: { id }, data: { ativo: false } });
}

/** Tipos vencidos de um veiculo ("Troca de óleo vencida há 320 km") — pra escala avisar. */
export async function manutencoesVencidas(veiculoId: string): Promise<string[]> {
  const { planos } = await listarPlanos(veiculoId);
  return planos
    .filter((p) => p.estado.situacao === "vencida")
    .map((p) => {
      const km = p.estado.restanteKm != null && p.estado.restanteKm <= 0 ? ` há ${Math.abs(p.estado.restanteKm).toLocaleString("pt-BR")} km` : "";
      const dias = p.estado.restanteDias != null && p.estado.restanteDias <= 0 ? ` há ${Math.abs(p.estado.restanteDias)} dias` : "";
      return `${p.tipo} vencida${km || dias}`;
    });
}

/**
 * O sino: avisa gestores de plano que venceu ou vai vencer, uma vez por
 * vencimento (trava `avisadoEm`, zerada ao concluir).
 */
export async function avisarManutencoes(): Promise<number> {
  const planos = await prisma.planoManutencao.findMany({
    where: { ativo: true, avisadoEm: null, veiculo: { ativo: true, status: { not: "inativo" } } },
    select: { id: true, tipo: true, intervaloKm: true, intervaloDias: true, ultimaKm: true, ultimaEm: true, veiculoId: true, veiculo: { select: { placa: true, apelido: true } } },
  });
  if (planos.length === 0) return 0;
  const gestores = await prisma.usuario.findMany({ where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true }, select: { id: true } });
  const odometros = new Map<string, number | null>();
  let avisados = 0;
  for (const p of planos) {
    if (!odometros.has(p.veiculoId)) odometros.set(p.veiculoId, await odometroAtual(p.veiculoId));
    const e = estadoManutencao({ ...p, ultimaEm: p.ultimaEm ? p.ultimaEm.toISOString() : null }, odometros.get(p.veiculoId) ?? null);
    if (e.situacao !== "vencida" && e.situacao !== "vence_em_breve") continue;
    const carro = p.veiculo.apelido ? `${p.veiculo.apelido} · ${formatarPlaca(p.veiculo.placa)}` : formatarPlaca(p.veiculo.placa);
    const quando =
      e.situacao === "vencida"
        ? "vencida"
        : `vence em ${[e.restanteKm != null ? `${e.restanteKm} km` : null, e.restanteDias != null ? `${e.restanteDias} dias` : null].filter(Boolean).join(" / ")}`;
    await prisma.$transaction([
      prisma.planoManutencao.update({ where: { id: p.id }, data: { avisadoEm: new Date() } }),
      prisma.notificacao.createMany({
        data: gestores.map((g) => ({ usuarioId: g.id, tipo: e.situacao === "vencida" ? "manutencao_vencida" : "manutencao_vencendo", mensagem: `${p.tipo} ${quando}: ${carro}` })),
      }),
    ]);
    avisados += 1;
  }
  return avisados;
}
