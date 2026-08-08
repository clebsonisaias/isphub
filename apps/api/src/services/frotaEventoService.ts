import { Prisma, type EstadoIgnicao } from "@prisma/client";
import {
  avancarViagem,
  derivarEventos,
  type EventoRastreadorTipo,
  type MapaSensores,
  type PontoViagem,
  type ViagemAberta,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";

/**
 * EVENTOS E VIAGENS — o que a coleta faz alem de gravar o ponto.
 *
 * A serie de posicao responde "onde o carro estava". Este arquivo responde as
 * outras duas perguntas: "o que mudou" (EventoRastreador) e "quantas saidas ele
 * fez e quanto rodou" (Viagem).
 *
 * As REGRAS nao moram aqui — moram em `@isphub/shared` (`derivarEventos` e
 * `avancarViagem`), puras e testadas sem banco. Aqui fica so a traducao delas
 * para linhas: o que e INSERT, o que e UPDATE, e o que fazer quando duas
 * replicas chegam juntas.
 */

/** O ponto novo, ja com tudo que as regras puras precisam. */
export interface LeituraNova {
  rastreadorId: string;
  veiculoId: string;
  registradoEm: Date;
  lat: number;
  lng: number;
  velocidadeKmh: number | null;
  sensores: MapaSensores;
  ignicao: EstadoIgnicao | null;
}

/**
 * O que sabiamos do aparelho ANTES deste ponto.
 *
 * Sai da POSICAO anterior, e nao do cache em `Rastreador`, por duas razoes:
 *
 * (a) a velocidade so existe na posicao — e sem ela a guarda de borda do
 *     excesso de velocidade nao funciona: com `null`, um carro a 118 km/h por
 *     dez minutos gera dez alertas iguais em vez de um;
 * (b) o cache do rastreador e sobrescrito a cada tique com o mapa que veio, e
 *     um aparelho offline manda so o `COMMUNICATION` — o cache fica truncado.
 *     A serie de posicoes guarda cada fotografia como ela foi.
 */
export interface EstadoAnterior {
  /** `null` = nunca coletamos deste aparelho. E o unico caso de "descoberta". */
  sensores: MapaSensores | null;
  velocidadeKmh: number | null;
}

/**
 * Le a fotografia imediatamente anterior a esta.
 *
 * `lt` e nao `lte`: a posicao nova ja foi gravada quando isto roda, e comparar
 * um ponto consigo mesmo nunca produz transicao.
 */
export async function estadoAnteriorDe(rastreadorId: string, antesDe: Date): Promise<EstadoAnterior> {
  const p = await prisma.posicaoRastreador.findFirst({
    where: { rastreadorId, registradoEm: { lt: antesDe } },
    orderBy: { registradoEm: "desc" },
    select: { sensores: true, velocidadeKmh: true },
  });
  if (!p) return { sensores: null, velocidadeKmh: null };
  /*
   * Posicao anterior SEM sensores (o status do fornecedor falhou naquele
   * minuto) vira mapa VAZIO, e nao `null`. A diferenca decide tudo: `null`
   * significaria "primeira leitura" e liberaria eventos de descoberta; o mapa
   * vazio significa "havia fotografia, mas nao sabemos o que ela dizia" — e
   * ignorancia nao gera transicao nenhuma.
   */
  return { sensores: comoMapaSensores(p.sensores) ?? {}, velocidadeKmh: p.velocidadeKmh };
}

export interface ResultadoDerivacao {
  eventos: number;
  viagensAbertas: number;
  viagensFechadas: number;
}

/**
 * `Json?` do Prisma volta como `Prisma.JsonValue` — pode ser array, numero,
 * string, `null` ou o objeto que gravamos.
 *
 * Distinguir `null` de `{}` importa: `null` significa "nunca coletamos deste
 * aparelho", e e o UNICO caso que vira `anterior = null` em `derivarEventos` —
 * ou seja, o unico em que a primeira leitura pode virar evento. Um objeto vazio
 * significa "coletamos e nao veio sensor nenhum", que e ignorancia, nao
 * descoberta.
 */
export function comoMapaSensores(v: Prisma.JsonValue | null | undefined): MapaSensores | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const saida: MapaSensores = {};
  for (const [k, valor] of Object.entries(v)) if (typeof valor === "string") saida[k] = valor;
  return saida;
}

const IGNICAO_LIGADA: Record<string, boolean | null> = { ligada: true, desligada: false, anomalia: null };

/**
 * `EstadoIgnicao` -> o booleano tri-estado que `avancarViagem` espera.
 *
 * `anomalia` vira `null`, e nao `false`, de proposito: o sensor de ignicao com
 * defeito nao pode FECHAR uma viagem. Fechar ali diria que o tecnico chegou.
 */
function ignicaoParaViagem(e: EstadoIgnicao | null): boolean | null {
  return e ? (IGNICAO_LIGADA[e] ?? null) : null;
}

/** A linha aberta do banco vira o acumulador da funcao pura. */
function comoViagemAberta(v: {
  inicioEm: Date;
  latInicio: number;
  lngInicio: number;
  latFim: number;
  lngFim: number;
  ultimoEm: Date | null;
  ultimaVelocidadeKmh: number | null;
  distanciaMetros: number | null;
  velocidadeMaxKmh: number | null;
  paradoComMotorLigadoSeg: number | null;
}): ViagemAberta {
  return {
    inicioEm: v.inicioEm,
    latInicio: v.latInicio,
    lngInicio: v.lngInicio,
    // `ultimoEm` so e nulo numa linha gravada antes da coluna existir; cair no
    // inicio e conservador — no maximo perde a distancia de um trecho.
    ultimoEm: v.ultimoEm ?? v.inicioEm,
    ultimaLat: v.latFim,
    ultimaLng: v.lngFim,
    ultimaVelocidadeKmh: v.ultimaVelocidadeKmh,
    distanciaMetros: v.distanciaMetros ?? 0,
    velocidadeMaxKmh: v.velocidadeMaxKmh,
    paradoComMotorLigadoSeg: v.paradoComMotorLigadoSeg ?? 0,
    pontos: 0,
  };
}

/**
 * Quem esta ao volante deste veiculo agora — para carimbar na viagem.
 *
 * `null` e NORMAL e nao e erro: o carro pode rodar sem ninguem ter declarado
 * nada, e a viagem existiu do mesmo jeito. Por isso `Viagem.ocupacaoId` e
 * opcional com `onDelete: SetNull`.
 */
async function motoristaDoVeiculo(veiculoId: string): Promise<string | null> {
  const o = await prisma.ocupacaoVeiculo.findFirst({
    where: { veiculoId, fimEm: null, papel: "motorista" },
    select: { id: true },
  });
  return o?.id ?? null;
}

/** P2002 = corrida entre replicas. Mesmo predicado de `ehCorridaDeMotorista`. */
function ehCorrida(e: unknown): boolean {
  return !!e && typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "P2002";
}

/**
 * Aplica UM ponto novo: grava os eventos que ele revela e move a viagem.
 *
 * NAO abre transacao, e isso e deliberado. `coletarDeUmaConfig` tambem nao abre,
 * pela razao documentada em `ocupacaoService`: no Postgres um statement que
 * falha aborta a transacao inteira, entao um P2002 esperado (a corrida entre
 * duas replicas) derrubaria junto tudo que ja tinha sido gravado no tique —
 * inclusive as posicoes dos outros rastreadores.
 *
 * Cada escrita e independente e idempotente por chave natural. O pior caso de
 * uma falha no meio e um tique parcial, que o proximo completa.
 */
export async function aplicarLeitura(
  leitura: LeituraNova,
  anterior: EstadoAnterior,
  opcoes: { limiteVelocidadeKmh: number },
): Promise<ResultadoDerivacao> {
  const r: ResultadoDerivacao = { eventos: 0, viagensAbertas: 0, viagensFechadas: 0 };

  // 1) EVENTOS — o que mudou entre a fotografia anterior e esta.
  const eventos = derivarEventos(
    anterior.sensores === null ? null : { mapa: anterior.sensores, velocidadeKmh: anterior.velocidadeKmh },
    { mapa: leitura.sensores, velocidadeKmh: leitura.velocidadeKmh },
    { limiteVelocidadeKmh: opcoes.limiteVelocidadeKmh },
  );

  if (eventos.length > 0) {
    /*
     * `em` = o carimbo DO APARELHO, nunca `new Date()`.
     *
     * A chave natural e (rastreadorId, tipo, em). Duas replicas derivam o MESMO
     * evento do mesmo par de leituras — mas so concordam no `em` se ele vier do
     * dispositivo. Com o relogio do servidor, cada replica gravaria um `em`
     * diferente, o unique nao dedupliraria nada, e o sino tocaria duas vezes.
     */
    const criados = await prisma.eventoRastreador.createMany({
      data: eventos.map((e) => ({
        rastreadorId: leitura.rastreadorId,
        veiculoId: leitura.veiculoId,
        tipo: e.tipo as EventoRastreadorTipo,
        em: leitura.registradoEm,
        lat: leitura.lat,
        lng: leitura.lng,
        detalhe: (e.detalhe ?? Prisma.DbNull) as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    r.eventos = criados.count;
  }

  // 2) VIAGEM — a mesma regra da funcao pura, um ponto por vez.
  const abertaNoBanco = await prisma.viagem.findFirst({
    where: { veiculoId: leitura.veiculoId, fimEm: null },
    select: {
      id: true,
      inicioEm: true,
      latInicio: true,
      lngInicio: true,
      latFim: true,
      lngFim: true,
      ultimoEm: true,
      ultimaVelocidadeKmh: true,
      distanciaMetros: true,
      velocidadeMaxKmh: true,
      paradoComMotorLigadoSeg: true,
    },
  });

  const ponto: PontoViagem = {
    lat: leitura.lat,
    lng: leitura.lng,
    em: leitura.registradoEm,
    ignicao: ignicaoParaViagem(leitura.ignicao),
    velocidadeKmh: leitura.velocidadeKmh,
  };

  const passo = avancarViagem(abertaNoBanco ? comoViagemAberta(abertaNoBanco) : null, ponto);

  if (passo.fechar && abertaNoBanco) {
    await prisma.viagem.update({
      where: { id: abertaNoBanco.id },
      data: {
        fimEm: passo.fechar.fimEm,
        latFim: passo.fechar.latFim,
        lngFim: passo.fechar.lngFim,
        ultimoEm: passo.fechar.fimEm,
        distanciaMetros: passo.fechar.distanciaMetros,
        velocidadeMaxKmh: passo.fechar.velocidadeMaxKmh,
        paradoComMotorLigadoSeg: passo.fechar.paradoComMotorLigadoSeg,
      },
    });
    r.viagensFechadas = 1;
  }

  if (passo.aberta && passo.nova) {
    /*
     * A checagem ("ja ha aberta?") aconteceu acima, ANTES do insert — a regra
     * da casa. O indice parcial `viagens_uma_aberta_por_veiculo` continua sendo
     * a rede para a corrida REAL entre duas replicas, e um P2002 aqui significa
     * que a outra replica abriu a mesma viagem: o objetivo foi cumprido, so nao
     * por nos. Nao e erro.
     */
    try {
      await prisma.viagem.create({
        data: {
          veiculoId: leitura.veiculoId,
          rastreadorId: leitura.rastreadorId,
          ocupacaoId: await motoristaDoVeiculo(leitura.veiculoId),
          inicioEm: passo.aberta.inicioEm,
          latInicio: passo.aberta.latInicio,
          lngInicio: passo.aberta.lngInicio,
          latFim: passo.aberta.ultimaLat,
          lngFim: passo.aberta.ultimaLng,
          ultimoEm: passo.aberta.ultimoEm,
          ultimaVelocidadeKmh: passo.aberta.ultimaVelocidadeKmh,
          distanciaMetros: Math.round(passo.aberta.distanciaMetros),
          velocidadeMaxKmh: passo.aberta.velocidadeMaxKmh,
          paradoComMotorLigadoSeg: Math.round(passo.aberta.paradoComMotorLigadoSeg),
        },
      });
      r.viagensAbertas = 1;
    } catch (e) {
      if (!ehCorrida(e)) throw e;
    }
  } else if (passo.aberta && abertaNoBanco) {
    await prisma.viagem.update({
      where: { id: abertaNoBanco.id },
      data: {
        latFim: passo.aberta.ultimaLat,
        lngFim: passo.aberta.ultimaLng,
        ultimoEm: passo.aberta.ultimoEm,
        ultimaVelocidadeKmh: passo.aberta.ultimaVelocidadeKmh,
        distanciaMetros: Math.round(passo.aberta.distanciaMetros),
        velocidadeMaxKmh: passo.aberta.velocidadeMaxKmh,
        paradoComMotorLigadoSeg: Math.round(passo.aberta.paradoComMotorLigadoSeg),
      },
    });
  }

  return r;
}

// ---------------------------------------------------------------------------
// EVENTOS POR DURACAO
// ---------------------------------------------------------------------------

/**
 * Dois dos quatro alertas nao nascem de comparar duas fotografias — nascem de
 * TEMPO DECORRIDO, e duas fotografias nao contem tempo suficiente para afirma-lo:
 *
 *   "rastreador sem comunicar ha mais de 6h" — a transicao UP->DOWN acontece
 *   toda vez que o aparelho pisca, e alertar nela seria alertar por nada.
 *
 *   "parado com o motor ligado ha mais de 10 min" — so a viagem aberta sabe
 *   quanto tempo ja se acumulou.
 *
 * Por isso `derivarEventos` nao os produz e eles vivem aqui, varridos pelo job.
 *
 * O DESAFIO destes dois e a idempotencia: sem um par (antes, depois) para
 * ancorar, o `em` obvio seria `new Date()` — e ai cada varredura criaria um
 * evento novo do mesmo fato, e duas replicas criariam dois. A solucao e ancorar
 * o `em` num carimbo que ja identifica o EPISODIO:
 *
 *   offline  -> `ultimaPosicaoEm` (relogio do aparelho): um evento por queda.
 *   parado   -> `viagem.inicioEm`: um evento por viagem.
 *
 * Com isso a chave natural `(rastreadorId, tipo, em)` recusa a repeticao no
 * banco, que e o unico lugar onde duas replicas concordam.
 */
const OFFLINE_MS = 6 * 60 * 60_000;
const PARADO_MOTOR_LIGADO_SEG = 10 * 60;

export async function detectarEventosPorDuracao(agora = new Date()): Promise<number> {
  let criados = 0;

  const mudos = await prisma.rastreador.findMany({
    where: {
      ativo: true,
      comunicando: false,
      OR: [{ ultimaPosicaoEm: null }, { ultimaPosicaoEm: { lt: new Date(agora.getTime() - OFFLINE_MS) } }],
      vinculos: { some: { fimEm: null } },
    },
    select: {
      id: true,
      criadoEm: true,
      ultimaPosicaoEm: true,
      vinculos: { where: { fimEm: null }, select: { veiculoId: true }, take: 1 },
    },
  });

  for (const r of mudos) {
    // Sem nenhuma posicao na vida, o cadastro e a unica ancora estavel que
    // existe — e ainda assim e estavel, que e o que a chave natural precisa.
    const em = r.ultimaPosicaoEm ?? r.criadoEm;
    const n = await prisma.eventoRastreador.createMany({
      data: [
        {
          rastreadorId: r.id,
          veiculoId: r.vinculos[0]?.veiculoId ?? null,
          tipo: "ficou_offline",
          em,
          detalhe: { desde: em.toISOString() },
        },
      ],
      skipDuplicates: true,
    });
    criados += n.count;
  }

  const ociosas = await prisma.viagem.findMany({
    where: { fimEm: null, paradoComMotorLigadoSeg: { gte: PARADO_MOTOR_LIGADO_SEG } },
    select: { id: true, rastreadorId: true, veiculoId: true, inicioEm: true, paradoComMotorLigadoSeg: true, latFim: true, lngFim: true },
  });

  for (const v of ociosas) {
    const n = await prisma.eventoRastreador.createMany({
      data: [
        {
          rastreadorId: v.rastreadorId,
          veiculoId: v.veiculoId,
          tipo: "parado_com_motor_ligado",
          // Ancorado no INICIO da viagem: um alerta por viagem, e nao um a cada
          // varredura enquanto o carro seguir ocioso.
          em: v.inicioEm,
          lat: v.latFim,
          lng: v.lngFim,
          detalhe: { minutos: Math.round((v.paradoComMotorLigadoSeg ?? 0) / 60) },
        },
      ],
      skipDuplicates: true,
    });
    criados += n.count;
  }

  return criados;
}
