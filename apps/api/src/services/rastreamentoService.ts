import { simplificarTrilha, type RastreadorConnector, type StatusRastreador } from "@isphub/shared";
import { comConcorrenciaLimitada } from "../lib/limitador.js";
import { prisma } from "../lib/prisma.js";
import { buildRastreadorConnector } from "./rastreadorService.js";

/**
 * Coleta de posicoes — o corpo do tique, separado do cron pra ter teste.
 *
 * A PlataformaTK NAO tem webhook: e polling. Duas consequencias mandam no
 * desenho:
 *
 * (a) `/trackers/status` e a UNICA chamada em lote. Posicao e uma requisicao
 *     POR rastreador, entao o custo cresce linear com a frota — e por isso
 *     existe o teto por tique.
 * (b) o BANCO e o cache. A web le `PosicaoRastreador`, nunca o fornecedor. Um
 *     cache em memoria (como o da integracao de referencia) daria duas
 *     verdades assim que houvesse uma segunda replica.
 */

/**
 * Teto por tique. Com 1 chamada de status + ate 40 de posicao, sao no maximo
 * 41 requisicoes/minuto por credencial — folga confortavel abaixo dos 60/min
 * que a integracao de referencia adotou (o fornecedor nao documenta limite).
 */
const MAX_RASTREADORES_POR_TIQUE = 40;
/**
 * `comConcorrenciaLimitada` limita CONCORRENCIA, nao taxa — chamar de rate
 * limiter seria errado. O teto de taxa e o de cima; isto aqui impede que 40
 * `fetch` saiam numa rajada so.
 */
const MAX_CONCORRENTE = 4;

export interface ResumoColeta {
  configId: string;
  consultados: number;
  gravados: number;
  statusOk: boolean;
  erro: string | null;
}

/** Uma credencial e seus rastreadores COM veiculo vinculado. */
async function rastreadoresParaColetar(provedorId: string | null) {
  return prisma.rastreador.findMany({
    where: {
      ativo: true,
      provedorId,
      // Rastreador sem veiculo custa uma requisicao e devolve uma posicao que
      // nao da pra atribuir a ninguem.
      vinculos: { some: { fimEm: null } },
    },
    // Mais desatualizado primeiro, NULL na frente: sob o teto, a fila drena
    // com justica em vez de sempre servir os mesmos.
    orderBy: [{ ultimaPosicaoEm: { sort: "asc", nulls: "first" } }],
    take: MAX_RASTREADORES_POR_TIQUE,
    select: { id: true, identificadorExterno: true },
  });
}

/**
 * Coleta de UMA credencial.
 *
 * Recebe o conector por parametro pra o teste poder injetar um duble sem rede.
 */
export async function coletarDeUmaConfig(
  config: { id: string; provedorId: string | null; fornecedor: "plataformatk"; baseUrl: string; chaveCifrada: string },
  conector: RastreadorConnector = buildRastreadorConnector(config),
): Promise<ResumoColeta> {
  const rastreadores = await rastreadoresParaColetar(config.provedorId);
  const resumo: ResumoColeta = { configId: config.id, consultados: rastreadores.length, gravados: 0, statusOk: true, erro: null };
  if (rastreadores.length === 0) return resumo;

  // 1) Uma chamada cobre a frota inteira.
  const status = await conector.statusDeTodos();
  const porId = new Map<string, StatusRastreador>();
  if (status.tipo === "lista") {
    for (const s of status.itens) porId.set(s.identificadorExterno, s);
  } else {
    /*
     * Status indisponivel NAO aborta a coleta de posicao: sao duas perguntas
     * diferentes, e a posicao continua valendo. Os campos de status ficam
     * `null` — "nao sabemos" —, que e a verdade.
     */
    resumo.statusOk = false;
    resumo.erro = status.motivo;
  }

  // 2) Posicao, uma por rastreador, com concorrencia limitada.
  const posicoes = await Promise.all(
    rastreadores.map((r) =>
      comConcorrenciaLimitada(`ptk:${config.id}`, MAX_CONCORRENTE, async () => ({
        rastreador: r,
        resultado: await conector.ultimaPosicao(r.identificadorExterno),
      })),
    ),
  );

  const agora = new Date();
  const novas: {
    rastreadorId: string;
    registradoEm: Date;
    lat: number;
    lng: number;
    velocidadeKmh: number | null;
    movendo: boolean | null;
    comunicando: boolean | null;
    rastreando: boolean | null;
  }[] = [];

  for (const { rastreador, resultado } of posicoes) {
    const s = porId.get(rastreador.identificadorExterno);

    // Cache de leitura no proprio rastreador — recomputavel, so pra lista.
    await prisma.rastreador.update({
      where: { id: rastreador.id },
      data: {
        ultimoStatusEm: status.tipo === "lista" ? agora : undefined,
        comunicando: s ? s.comunicando : undefined,
        rastreando: s ? s.rastreando : undefined,
        ...(resultado.tipo === "posicao" ? { ultimaPosicaoEm: new Date(resultado.registradoEm) } : {}),
      },
    });

    /*
     * `indeterminado` NUNCA vira linha. Busca que falhou nao sabe nada — e
     * gravar um ponto ali poria no historico uma posicao que o carro nunca
     * ocupou. A ultima conhecida fica, e a tela mostra a IDADE dela.
     */
    if (resultado.tipo !== "posicao") continue;

    novas.push({
      rastreadorId: rastreador.id,
      registradoEm: new Date(resultado.registradoEm),
      lat: resultado.lat,
      lng: resultado.lng,
      velocidadeKmh: resultado.velocidadeKmh,
      movendo: s?.movendo ?? null,
      comunicando: s?.comunicando ?? null,
      rastreando: s?.rastreando ?? null,
    });
  }

  if (novas.length > 0) {
    /*
     * `skipDuplicates` + o unique (rastreadorId, registradoEm) e o que faz duas
     * replicas rodando o mesmo job serem desperdicio, e nao corrupcao: as duas
     * recebem o MESMO `time` do fornecedor, e a segunda insercao vira no-op.
     * Um carro parado tambem nao acumula linha, pelo mesmo motivo.
     */
    const r = await prisma.posicaoRastreador.createMany({ data: novas, skipDuplicates: true });
    resumo.gravados = r.count;
  }

  await prisma.rastreadorConfig.update({
    where: { id: config.id },
    data: { ultimaColetaEm: agora, ultimaColetaOk: resumo.erro === null, ultimaColetaMensagem: resumo.erro },
  });

  return resumo;
}

/** Credenciais ativas cujo intervalo ja venceu — mesmo criterio do syncScheduler. */
export async function configsVencidas(agora: Date) {
  const todas = await prisma.rastreadorConfig.findMany({ where: { ativo: true } });
  return todas.filter(
    (c) => !c.ultimaColetaEm || agora.getTime() - c.ultimaColetaEm.getTime() >= c.intervaloPollingSegundos * 1000,
  );
}

// ---------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------

export interface PosicaoNoMapa {
  veiculoId: string;
  placa: string;
  modelo: string;
  provedorNome: string | null;
  lat: number;
  lng: number;
  velocidadeKmh: number | null;
  registradoEm: string;
  movendo: boolean | null;
  comunicando: boolean | null;
  rastreadorId: string;
}

/**
 * Ultima posicao de cada veiculo COM vinculo aberto.
 *
 * A atribuicao acontece na LEITURA: a posicao pendura no rastreador, e o
 * veiculo sai do vinculo vigente. Gravar `veiculoId` no ponto congelaria uma
 * associacao que ainda vai mudar.
 */
export async function mapaAoVivo(where: Record<string, unknown> = {}): Promise<PosicaoNoMapa[]> {
  const vinculos = await prisma.vinculoRastreador.findMany({
    where: { fimEm: null, veiculo: where },
    select: {
      rastreadorId: true,
      rastreador: { select: { comunicando: true } },
      veiculo: { select: { id: true, placa: true, modelo: true, provedor: { select: { nome: true } } } },
    },
  });
  if (vinculos.length === 0) return [];

  const pontos = await Promise.all(
    vinculos.map((v) =>
      prisma.posicaoRastreador.findFirst({
        where: { rastreadorId: v.rastreadorId },
        orderBy: { registradoEm: "desc" },
        select: { lat: true, lng: true, velocidadeKmh: true, registradoEm: true, movendo: true, comunicando: true },
      }),
    ),
  );

  const saida: PosicaoNoMapa[] = [];
  vinculos.forEach((v, i) => {
    const p = pontos[i];
    // Sem nenhuma posicao ainda, o veiculo simplesmente nao entra no mapa —
    // melhor ausente que num pino no meio do oceano.
    if (!p) return;
    saida.push({
      veiculoId: v.veiculo.id,
      placa: v.veiculo.placa,
      modelo: v.veiculo.modelo,
      provedorNome: v.veiculo.provedor?.nome ?? null,
      lat: p.lat,
      lng: p.lng,
      velocidadeKmh: p.velocidadeKmh,
      registradoEm: p.registradoEm.toISOString(),
      movendo: p.movendo,
      comunicando: p.comunicando ?? v.rastreador.comunicando,
      rastreadorId: v.rastreadorId,
    });
  });
  return saida;
}

/**
 * Trilha de um veiculo num intervalo — o PERCURSO.
 *
 * Junta os pontos de TODOS os rastreadores que estiveram no veiculo naquele
 * periodo, cada um so na fatia em que o vinculo valia. Sem isso, trocar de
 * aparelho no meio do dia partiria a trilha em duas.
 *
 * Decimada no SERVIDOR: 10h de operacao sao ~1.200 pontos, e a esmagadora
 * maioria esta em linha reta numa avenida. Mandar todos infla o JSON sem
 * acrescentar um pixel.
 */
export async function trilha(
  veiculoId: string,
  de: Date,
  ate: Date,
  precisao: "alta" | "media" = "media",
): Promise<{ lat: number; lng: number; em: string; velocidadeKmh: number | null }[]> {
  const vinculos = await prisma.vinculoRastreador.findMany({
    where: { veiculoId, inicioEm: { lte: ate }, OR: [{ fimEm: null }, { fimEm: { gt: de } }] },
    select: { rastreadorId: true, inicioEm: true, fimEm: true },
  });
  if (vinculos.length === 0) return [];

  const porVinculo = await Promise.all(
    vinculos.map((v) =>
      prisma.posicaoRastreador.findMany({
        where: {
          rastreadorId: v.rastreadorId,
          registradoEm: {
            gte: v.inicioEm > de ? v.inicioEm : de,
            lte: v.fimEm && v.fimEm < ate ? v.fimEm : ate,
          },
        },
        orderBy: { registradoEm: "asc" },
        select: { lat: true, lng: true, registradoEm: true, velocidadeKmh: true },
      }),
    ),
  );

  const pontos = porVinculo
    .flat()
    .sort((a, b) => a.registradoEm.getTime() - b.registradoEm.getTime())
    .map((p) => ({ lat: p.lat, lng: p.lng, em: p.registradoEm.toISOString(), velocidadeKmh: p.velocidadeKmh }));

  // 5 m mantem curva de esquina; 25 m e o suficiente pra desenhar o trajeto.
  return simplificarTrilha(pontos, precisao === "alta" ? 5 : 25);
}
