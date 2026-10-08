import { odometroMonotonico } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * CHECKLIST DA VIATURA — o que o tecnico registra na saida e no retorno:
 * km do painel, combustivel, avarias e a foto do painel.
 *
 * Foto em bytea (<= 1 MB, comprimida no app): e dado NOSSO, nao do SGP, entao
 * o padrao de evidencia (proxy pro ERP) nao cabe. Mesmo desenho da foto de
 * perfil do usuario.
 */
export const FOTO_MAX_BYTES = 1024 * 1024;

export interface ChecklistInput {
  combustivelPct?: number | null;
  avarias?: string | null;
  /** Base64 puro. */
  fotoPainel?: string | null;
  fotoMime?: string | null;
}

export async function registrarChecklist(args: {
  ocupacaoId: string;
  momento: "saida" | "retorno";
  odometroKm?: number | null;
  geo?: { lat?: number | null; lng?: number | null };
  checklist?: ChecklistInput | null;
}) {
  const oc = await prisma.ocupacaoVeiculo.findUnique({ where: { id: args.ocupacaoId }, select: { veiculoId: true, usuarioId: true, veiculo: { select: { odometroKm: true } } } });
  if (!oc) throw new HttpError(404, "Ocupacao nao encontrada");
  let foto: Uint8Array<ArrayBuffer> | null = null;
  if (args.checklist?.fotoPainel) {
    foto = Uint8Array.from(Buffer.from(args.checklist.fotoPainel, "base64"));
    if (foto.byteLength > FOTO_MAX_BYTES) throw new HttpError(413, "Foto do painel acima de 1 MB");
  }
  const c = await prisma.checklistViatura.create({
    data: {
      ocupacaoId: args.ocupacaoId,
      veiculoId: oc.veiculoId,
      usuarioId: oc.usuarioId,
      momento: args.momento,
      odometroKm: args.odometroKm ?? null,
      combustivelPct: args.checklist?.combustivelPct ?? null,
      avarias: args.checklist?.avarias?.trim() || null,
      fotoPainel: foto,
      fotoMime: foto ? (args.checklist?.fotoMime ?? "image/jpeg") : null,
      lat: args.geo?.lat ?? null,
      lng: args.geo?.lng ?? null,
    },
    select: { id: true },
  });
  // O km digitado alimenta o cache do veiculo, que so sobe (odometroMonotonico).
  if (args.odometroKm != null) {
    const novo = odometroMonotonico(oc.veiculo.odometroKm, args.odometroKm);
    if (novo != null && novo !== oc.veiculo.odometroKm) await prisma.veiculo.update({ where: { id: oc.veiculoId }, data: { odometroKm: novo } });
  }
  return c;
}

export async function listarChecklists(veiculoId: string, de: Date, ate: Date) {
  const linhas = await prisma.checklistViatura.findMany({
    where: { veiculoId, criadoEm: { gte: de, lte: ate } },
    orderBy: { criadoEm: "desc" },
    take: 100,
    select: {
      id: true, momento: true, odometroKm: true, combustivelPct: true, avarias: true, fotoMime: true, criadoEm: true, usuarioId: true, ocupacaoId: true,
    },
  });
  const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.usuarioId))] } }, select: { id: true, nome: true, nomeExibicao: true } })).map((u) => [u.id, u.nomeExibicao || u.nome]));
  return linhas.map((l) => ({
    id: l.id,
    momento: l.momento as "saida" | "retorno",
    odometroKm: l.odometroKm,
    combustivelPct: l.combustivelPct,
    avarias: l.avarias,
    temFoto: !!l.fotoMime,
    criadoEm: l.criadoEm.toISOString(),
    usuarioNome: nomes.get(l.usuarioId) ?? "—",
    ocupacaoId: l.ocupacaoId,
  }));
}

export async function fotoDoChecklist(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const c = await prisma.checklistViatura.findUnique({ where: { id }, select: { fotoPainel: true, fotoMime: true } });
  if (!c?.fotoPainel || !c.fotoMime) return null;
  return { bytes: c.fotoPainel, mime: c.fotoMime };
}
