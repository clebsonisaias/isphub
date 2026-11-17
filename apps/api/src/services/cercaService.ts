import { pontoDentroDaCerca, type CercaGeometria, type Ponto } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";

export interface CercaDto {
  id: string;
  provedorId: string | null;
  nome: string;
  tipo: "circulo" | "poligono";
  centroLat: number | null;
  centroLng: number | null;
  raioMetros: number | null;
  vertices: Ponto[] | null;
  cor: string;
  ativa: boolean;
  criadoEm: string;
}

function paraDto(c: {
  id: string;
  provedorId: string | null;
  nome: string;
  tipo: string;
  centroLat: number | null;
  centroLng: number | null;
  raioMetros: number | null;
  vertices: unknown;
  cor: string;
  ativa: boolean;
  criadoEm: Date;
}): CercaDto {
  return {
    id: c.id,
    provedorId: c.provedorId,
    nome: c.nome,
    tipo: c.tipo === "poligono" ? "poligono" : "circulo",
    centroLat: c.centroLat,
    centroLng: c.centroLng,
    raioMetros: c.raioMetros,
    vertices: Array.isArray(c.vertices) ? (c.vertices as Ponto[]) : null,
    cor: c.cor,
    ativa: c.ativa,
    criadoEm: c.criadoEm.toISOString(),
  };
}

function paraGeometria(c: {
  tipo: string;
  centroLat: number | null;
  centroLng: number | null;
  raioMetros: number | null;
  vertices: unknown;
}): CercaGeometria | null {
  if (c.tipo === "poligono") {
    if (!Array.isArray(c.vertices) || c.vertices.length < 3) return null;
    return { tipo: "poligono", vertices: c.vertices as Ponto[] };
  }
  if (c.centroLat == null || c.centroLng == null || c.raioMetros == null) return null;
  return {
    tipo: "circulo",
    centroLat: c.centroLat,
    centroLng: c.centroLng,
    raioMetros: c.raioMetros,
  };
}

export async function listarCercas(provedorIds?: string[] | null): Promise<CercaDto[]> {
  const where =
    provedorIds && provedorIds.length > 0
      ? { OR: [{ provedorId: null }, { provedorId: { in: provedorIds } }] }
      : {};
  const itens = await prisma.cercaVirtual.findMany({
    where,
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
  });
  return itens.map(paraDto);
}

export async function criarCerca(dados: {
  provedorId?: string | null;
  nome: string;
  tipo: "circulo" | "poligono";
  centroLat?: number | null;
  centroLng?: number | null;
  raioMetros?: number | null;
  vertices?: Ponto[] | null;
  cor?: string;
}): Promise<CercaDto> {
  const criada = await prisma.cercaVirtual.create({
    data: {
      provedorId: dados.provedorId ?? null,
      nome: dados.nome.trim(),
      tipo: dados.tipo,
      centroLat: dados.tipo === "circulo" ? dados.centroLat ?? null : null,
      centroLng: dados.tipo === "circulo" ? dados.centroLng ?? null : null,
      raioMetros: dados.tipo === "circulo" ? dados.raioMetros ?? null : null,
      vertices: dados.tipo === "poligono" && dados.vertices ? (dados.vertices as object) : undefined,
      cor: dados.cor ?? "#2563eb",
    },
  });
  return paraDto(criada);
}

export async function atualizarCerca(
  id: string,
  dados: {
    nome?: string;
    ativa?: boolean;
    cor?: string;
    raioMetros?: number;
  },
): Promise<CercaDto> {
  const atualizada = await prisma.cercaVirtual.update({
    where: { id },
    data: {
      ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
      ...(dados.ativa !== undefined ? { ativa: dados.ativa } : {}),
      ...(dados.cor !== undefined ? { cor: dados.cor } : {}),
      ...(dados.raioMetros !== undefined ? { raioMetros: dados.raioMetros } : {}),
    },
  });
  return paraDto(atualizada);
}

export async function excluirCerca(id: string): Promise<void> {
  await prisma.cercaVirtual.delete({ where: { id } });
}

/**
 * Avalia todas as cercas ativas aplicáveis ao rastreador na posição lida e
 * registra eventos `entrou_cerca` / `saiu_cerca` apenas quando há transição.
 */
export async function avaliarCercasParaLeitura(leitura: {
  rastreadorId: string;
  veiculoId: string;
  provedorId: string | null;
  registradoEm: Date;
  lat: number;
  lng: number;
}): Promise<number> {
  const cercas = await prisma.cercaVirtual.findMany({
    where: {
      ativa: true,
      OR: [{ provedorId: null }, ...(leitura.provedorId ? [{ provedorId: leitura.provedorId }] : [])],
    },
  });
  if (cercas.length === 0) return 0;

  const estadosAnteriores = await prisma.estadoCercaRastreador.findMany({
    where: {
      rastreadorId: leitura.rastreadorId,
      cercaId: { in: cercas.map((c) => c.id) },
    },
  });
  const porCerca = new Map(estadosAnteriores.map((e) => [e.cercaId, e.dentro]));

  let eventosGerados = 0;
  for (const cerca of cercas) {
    const geom = paraGeometria(cerca);
    if (!geom) continue;

    const dentroAgora = pontoDentroDaCerca({ lat: leitura.lat, lng: leitura.lng }, geom);
    const dentroAntes = porCerca.get(cerca.id);

    if (dentroAntes === undefined) {
      await prisma.estadoCercaRastreador.upsert({
        where: { cercaId_rastreadorId: { cercaId: cerca.id, rastreadorId: leitura.rastreadorId } },
        create: { cercaId: cerca.id, rastreadorId: leitura.rastreadorId, dentro: dentroAgora },
        update: { dentro: dentroAgora },
      });
      continue;
    }

    if (dentroAntes === dentroAgora) continue;

    await prisma.estadoCercaRastreador.update({
      where: { cercaId_rastreadorId: { cercaId: cerca.id, rastreadorId: leitura.rastreadorId } },
      data: { dentro: dentroAgora },
    });

    const tipo = dentroAgora ? "entrou_cerca" : "saiu_cerca";
    await prisma.eventoRastreador
      .create({
        data: {
          rastreadorId: leitura.rastreadorId,
          veiculoId: leitura.veiculoId,
          tipo,
          em: leitura.registradoEm,
          lat: leitura.lat,
          lng: leitura.lng,
          detalhe: { cercaId: cerca.id, cercaNome: cerca.nome },
        },
      })
      .then(() => {
        eventosGerados += 1;
      })
      .catch(() => {
        // Chave natural (rastreadorId, tipo, em) protege contra duplicidade entre réplicas.
      });
  }

  return eventosGerados;
}
