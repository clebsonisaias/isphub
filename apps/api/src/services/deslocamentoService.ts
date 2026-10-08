import { Prisma } from "@prisma/client";
import { densidadeSuficiente, medirDeslocamento, type FonteDeslocamento } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { janelaExecucao, veiculosDaOs } from "./ocupacaoService.js";
import { buildRastreadorConnector } from "./rastreadorService.js";

/**
 * KM POR OS — quanto a viatura rodou ate chegar nesta visita.
 *
 * O trajeto vai do FIM da parada anterior do mesmo tecnico no dia (ou do
 * inicio da ocupacao do veiculo) ate o INICIO da execucao desta OS. Soma as
 * posicoes do rastreador do veiculo nesse intervalo; quando a serie e esparsa
 * (1 ponto/min no poll, e as vezes menos), busca o historico no fornecedor e
 * GUARDA esses pontos — a densificacao serve pra qualquer leitura futura.
 */
export interface DeslocamentoPublic {
  ordemServicoId: string;
  veiculoId: string | null;
  inicioEm: string;
  fimEm: string;
  metros: number;
  pontos: number;
  fonte: FonteDeslocamento;
  calculadoEm: string;
}

const SELECT = {
  ordemServicoId: true,
  veiculoId: true,
  inicioEm: true,
  fimEm: true,
  metros: true,
  pontos: true,
  fonte: true,
  calculadoEm: true,
} satisfies Prisma.DeslocamentoOsSelect;

function serializar(d: Prisma.DeslocamentoOsGetPayload<{ select: typeof SELECT }>): DeslocamentoPublic {
  return {
    ...d,
    fonte: d.fonte as FonteDeslocamento,
    inicioEm: d.inicioEm.toISOString(),
    fimEm: d.fimEm.toISOString(),
    calculadoEm: d.calculadoEm.toISOString(),
  };
}

export async function deslocamentoDaOs(ordemServicoId: string): Promise<DeslocamentoPublic | null> {
  const d = await prisma.deslocamentoOs.findUnique({ where: { ordemServicoId }, select: SELECT });
  return d ? serializar(d) : null;
}

/** Rastreador vinculado ao veiculo num instante. */
async function rastreadorDoVeiculoEm(veiculoId: string, em: Date) {
  const v = await prisma.vinculoRastreador.findFirst({
    where: { veiculoId, inicioEm: { lte: em }, OR: [{ fimEm: null }, { fimEm: { gt: em } }] },
    orderBy: { inicioEm: "desc" },
    select: { rastreador: { select: { id: true, identificadorExterno: true, provedorId: true, fornecedor: true } } },
  });
  return v?.rastreador ?? null;
}

async function posicoesEntre(rastreadorId: string, de: Date, ate: Date) {
  return prisma.posicaoRastreador.findMany({
    where: { rastreadorId, registradoEm: { gte: de, lte: ate } },
    orderBy: { registradoEm: "asc" },
    select: { lat: true, lng: true, registradoEm: true },
  });
}

/**
 * Busca no fornecedor os pontos do intervalo e grava o que ainda nao existia.
 * Best-effort: fornecedor fora do ar so deixa a serie como estava.
 */
async function densificar(
  rastreador: { id: string; identificadorExterno: string; provedorId: string | null; fornecedor: "plataformatk" },
  de: Date,
  ate: Date,
): Promise<number> {
  const config = await prisma.rastreadorConfig.findFirst({
    where: { provedorId: rastreador.provedorId, ativo: true },
    select: { fornecedor: true, baseUrl: true, chaveCifrada: true },
  });
  if (!config) return 0;
  try {
    const r = await buildRastreadorConnector(config).historico(rastreador.identificadorExterno, de.toISOString(), ate.toISOString(), {
      distanciaM: 50,
      precisao: "high",
    });
    if (r.tipo !== "trecho" || r.pontos.length === 0) return 0;
    const criadas = await prisma.posicaoRastreador.createMany({
      data: r.pontos.map((p) => ({
        rastreadorId: rastreador.id,
        registradoEm: new Date(p.registradoEm),
        lat: p.lat,
        lng: p.lng,
        velocidadeKmh: p.velocidadeKmh,
      })),
      skipDuplicates: true,
    });
    return criadas.count;
  } catch (e) {
    console.warn(`[deslocamento] historico do rastreador ${rastreador.identificadorExterno} falhou:`, e);
    return 0;
  }
}

/**
 * Calcula (ou recalcula) o deslocamento de uma OS e grava. `null` quando nao
 * ha janela de execucao — OS fechada direto no SGP nao tem "chegada".
 */
export async function calcularDeslocamentoOs(ordemServicoId: string): Promise<DeslocamentoPublic | null> {
  const os = await prisma.ordemServico.findUnique({
    where: { id: ordemServicoId },
    select: { id: true, tecnicoId: true, lat: true, lng: true },
  });
  if (!os) return null;
  const janela = await janelaExecucao(ordemServicoId);
  if (!janela) return null;

  // Chegada = primeira transicao de execucao desta OS.
  const chegadaEm = janela.inicio;

  // Veiculo: o que o tecnico ocupava na hora da chegada.
  const veiculos = await veiculosDaOs(ordemServicoId);
  const ocupacao =
    veiculos.find((v) => Date.parse(v.ocupacao.inicioEm) <= chegadaEm.getTime() && (!v.ocupacao.fimEm || Date.parse(v.ocupacao.fimEm) > chegadaEm.getTime()))
      ?.ocupacao ?? veiculos[0]?.ocupacao ?? null;

  // Saida = fim da OS anterior do mesmo tecnico no mesmo dia (evento concluida
  // mais recente antes da chegada), senao inicio da ocupacao do veiculo, senao
  // 2h antes — teto pra nao somar o dia inteiro numa OS sem contexto.
  const inicioDoDia = new Date(chegadaEm);
  inicioDoDia.setUTCHours(inicioDoDia.getUTCHours() - 20);
  const anterior = os.tecnicoId
    ? await prisma.osEvento.findFirst({
        where: {
          statusPara: "concluida",
          criadoEm: { lt: chegadaEm, gte: inicioDoDia },
          ordemServico: { tecnicoId: os.tecnicoId },
          NOT: { ordemServicoId },
        },
        orderBy: { criadoEm: "desc" },
        select: { criadoEm: true, lat: true, lng: true },
      })
    : null;
  const tetoMs = 2 * 3_600_000;
  const inicioOcupacao = ocupacao ? Date.parse(ocupacao.inicioEm) : null;
  const saidaEm = new Date(
    Math.max(anterior?.criadoEm.getTime() ?? 0, inicioOcupacao ?? 0, chegadaEm.getTime() - tetoMs),
  );

  let posicoes: { lat: number; lng: number; registradoEm: Date }[] = [];
  const rastreador = ocupacao ? await rastreadorDoVeiculoEm(ocupacao.veiculoId, chegadaEm) : null;
  if (rastreador) {
    posicoes = await posicoesEntre(rastreador.id, saidaEm, chegadaEm);
    if (!densidadeSuficiente(posicoes.length, saidaEm, chegadaEm)) {
      const novas = await densificar(rastreador, saidaEm, chegadaEm);
      if (novas > 0) posicoes = await posicoesEntre(rastreador.id, saidaEm, chegadaEm);
    }
  }

  const medida = medirDeslocamento({
    posicoes: posicoes.map((p) => ({ lat: p.lat, lng: p.lng, em: p.registradoEm.toISOString() })),
    origemFallback: anterior?.lat != null && anterior.lng != null ? { lat: anterior.lat, lng: anterior.lng } : null,
    destinoFallback: os.lat != null && os.lng != null ? { lat: os.lat, lng: os.lng } : null,
  });

  const dados = {
    veiculoId: ocupacao?.veiculoId ?? null,
    inicioEm: saidaEm,
    fimEm: chegadaEm,
    metros: medida.metros,
    pontos: medida.pontos,
    fonte: medida.fonte,
    calculadoEm: new Date(),
  };
  const d = await prisma.deslocamentoOs.upsert({
    where: { ordemServicoId },
    create: { ordemServicoId, ...dados },
    update: dados,
    select: SELECT,
  });
  return serializar(d);
}

/** OS concluidas recentemente que ainda nao tem deslocamento calculado. */
export async function pendentesDeCalculo(limite = 50): Promise<string[]> {
  const desde = new Date(Date.now() - 24 * 3_600_000);
  const linhas = await prisma.ordemServico.findMany({
    where: { status: "concluida", statusAlteradoEm: { gte: desde }, deslocamento: null },
    orderBy: { statusAlteradoEm: "asc" },
    take: limite,
    select: { id: true },
  });
  return linhas.map((l) => l.id);
}

/** Km somados por regiao (POP ou bairro) num intervalo — o lado "custo" do teto por regiao. */
export async function kmPorRegiao(de: Date, ate: Date): Promise<{ regiao: string; metros: number; visitas: number }[]> {
  const linhas = await prisma.deslocamentoOs.findMany({
    where: { fimEm: { gte: de, lte: ate }, fonte: { not: "sem_dados" } },
    select: { metros: true, ordemServico: { select: { pop: true, bairro: true } } },
  });
  const acc = new Map<string, { metros: number; visitas: number }>();
  for (const l of linhas) {
    const regiao = l.ordemServico.pop ?? l.ordemServico.bairro ?? "Sem região";
    const a = acc.get(regiao) ?? { metros: 0, visitas: 0 };
    a.metros += l.metros;
    a.visitas += 1;
    acc.set(regiao, a);
  }
  return [...acc.entries()].map(([regiao, v]) => ({ regiao, ...v })).sort((a, b) => b.metros - a.metros);
}
