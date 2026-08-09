import { Prisma } from "@prisma/client";
import {
  sensoresParaExibir,
  simplificarTrilha,
  type DicionarioSensores,
  type EventoRastreadorTipo,
  type RastreadorConnector,
  type StatusRastreador,
  type TipoVeiculo,
} from "@isphub/shared";
import { comConcorrenciaLimitada } from "../lib/limitador.js";
import { prisma } from "../lib/prisma.js";
import { buildRastreadorConnector } from "./rastreadorService.js";
import { aplicarLeitura, comoMapaSensores, estadoAnteriorDe, type LeituraNova } from "./frotaEventoService.js";

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
  /** Quantos aparelhos tiveram o cadastro do fornecedor atualizado neste tique. */
  cadastrosAtualizados: number;
  dicionarioAtualizado: boolean;
  eventos: number;
  viagensAbertas: number;
  viagensFechadas: number;
}

/**
 * O cadastro e o dicionario mudam em ESCALA DE MES, nao de minuto.
 *
 * Buscar os dois a cada tique dobraria as requisicoes por credencial pra
 * atualizar dados que quase nunca mudam. Um dia e folgado: se um aparelho for
 * trocado hoje, a tela mostra o modelo antigo por algumas horas — e o modelo do
 * aparelho nao muda nenhuma decisao operacional.
 */
const CADASTRO_VALIDO_MS = 24 * 60 * 60_000;

/**
 * Espelha `GET /trackers` nos rastreadores que ja conhecemos.
 *
 * NAO cria rastreador: a conta do fornecedor tem aparelhos que nao sao nossos, e
 * cadastrar sozinho encheria a frota de carro alheio. Quem cadastra e o gestor.
 */
async function sincronizarCadastro(conector: RastreadorConnector, provedorId: string | null): Promise<number> {
  const r = await conector.cadastroDeTodos();
  if (r.tipo !== "lista") return 0;

  const nossos = await prisma.rastreador.findMany({
    where: { provedorId, ativo: true },
    select: { id: true, identificadorExterno: true },
  });
  const porExterno = new Map(nossos.map((x) => [x.identificadorExterno, x.id]));

  let n = 0;
  for (const c of r.itens) {
    const id = porExterno.get(c.identificadorExterno);
    if (!id) continue;
    await prisma.rastreador.update({
      where: { id },
      data: {
        modeloFornecedor: c.modelo,
        nomeFornecedor: c.nome,
        intervaloFornecedorSeg: c.intervaloSegundos,
        temComandoCorte: c.temComandoCorte,
        instaladoEm: c.instaladoEm ? new Date(c.instaladoEm) : null,
      },
    });
    n += 1;
  }
  return n;
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
    select: {
      id: true,
      identificadorExterno: true,
      /*
       * O VEICULO do vinculo vigente. `Viagem.veiculoId` e NOT NULL, e o filtro
       * ja garante que existe pelo menos um vinculo aberto — trazer aqui evita
       * uma consulta por rastreador dentro do laco.
       */
      vinculos: { where: { fimEm: null }, select: { veiculoId: true }, take: 1 },
    },
  });
}

/**
 * Coleta de UMA credencial.
 *
 * Recebe o conector por parametro pra o teste poder injetar um duble sem rede.
 */
export async function coletarDeUmaConfig(
  config: {
    id: string;
    provedorId: string | null;
    fornecedor: "plataformatk";
    baseUrl: string;
    chaveCifrada: string;
    dicionarioEm?: Date | null;
    limiteVelocidadeKmh?: number | null;
  },
  conector: RastreadorConnector = buildRastreadorConnector(config),
): Promise<ResumoColeta> {
  const rastreadores = await rastreadoresParaColetar(config.provedorId);
  const resumo: ResumoColeta = {
    configId: config.id,
    consultados: rastreadores.length,
    gravados: 0,
    statusOk: true,
    erro: null,
    cadastrosAtualizados: 0,
    dicionarioAtualizado: false,
    eventos: 0,
    viagensAbertas: 0,
    viagensFechadas: 0,
  };
  if (rastreadores.length === 0) return resumo;

  // 0) Cadastro e dicionario, no maximo uma vez por dia.
  const agoraMs = Date.now();
  const cadastroVencido = !config.dicionarioEm || agoraMs - config.dicionarioEm.getTime() >= CADASTRO_VALIDO_MS;
  if (cadastroVencido) {
    resumo.cadastrosAtualizados = await sincronizarCadastro(conector, config.provedorId);
    const dic = await conector.dicionarioDeSensores();
    if (dic.tipo === "dicionario") {
      await prisma.rastreadorConfig.update({
        where: { id: config.id },
        data: { dicionarioSensores: dic.dados as Prisma.InputJsonValue, dicionarioEm: new Date() },
      });
      resumo.dicionarioAtualizado = true;
    }
    /*
     * Dicionario que falhou NAO carimba `dicionarioEm`: o antigo continua
     * valendo (e melhor um rotulo de ontem que nenhum) e o proximo tique tenta
     * de novo. Carimbar mesmo em falha nos deixaria 24h sem tentar.
     */
  }

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
  const novas: Prisma.PosicaoRastreadorCreateManyInput[] = [];
  /**
   * As leituras que renderam ponto novo, guardadas para DEPOIS de gravar as
   * posicoes.
   *
   * Derivar evento e viagem antes do `createMany` inverteria a ordem dos fatos:
   * o sino poderia avisar "ignicao ligada" de um ponto que ainda nao existe na
   * serie, e um erro no meio deixaria evento sem a posicao que o originou.
   */
  const paraDerivar: LeituraNova[] = [];

  for (const { rastreador, resultado } of posicoes) {
    const s = porId.get(rastreador.identificadorExterno);

    // Cache de leitura no proprio rastreador — recomputavel, so pra lista.
    await prisma.rastreador.update({
      where: { id: rastreador.id },
      data: {
        ultimoStatusEm: status.tipo === "lista" ? agora : undefined,
        comunicando: s ? s.comunicando : undefined,
        rastreando: s ? s.rastreando : undefined,
        /*
         * O estado corrente. Sem `s` os campos ficam `undefined` (nao mexe), e
         * NAO `null` — apagar o ultimo estado conhecido so porque a consulta de
         * status falhou trocaria "esta bloqueado" por "nao sei", que e pior.
         */
        ignicao: s ? s.ignicao : undefined,
        bateriaPct: s ? s.bateriaPct : undefined,
        bloqueado: s ? s.bloqueado : undefined,
        sensores: s ? s.sensores : undefined,
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
      /*
       * Estes quatro JA vinham interpretados do conector e eram jogados fora
       * aqui, na ultima curva. A ignicao — que e o que faz uma VIAGEM existir —
       * chegava a cada minuto e nunca era gravada.
       */
      ignicao: s?.ignicao ?? null,
      bateriaPct: s?.bateriaPct ?? null,
      bloqueado: s?.bloqueado ?? null,
      sensores: s?.sensores ?? Prisma.DbNull,
    });

    const veiculoId = rastreador.vinculos[0]?.veiculoId;
    if (veiculoId) {
      paraDerivar.push({
        rastreadorId: rastreador.id,
        veiculoId,
        registradoEm: new Date(resultado.registradoEm),
        lat: resultado.lat,
        lng: resultado.lng,
        velocidadeKmh: resultado.velocidadeKmh,
        sensores: s?.sensores ?? {},
        ignicao: s?.ignicao ?? null,
      });
    }
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

    /*
     * Evento e viagem so DEPOIS da posicao existir na serie — a ordem dos fatos
     * importa: um evento "ignicao ligada" sem o ponto que o originou seria uma
     * afirmacao sem lastro na tela de historico.
     *
     * Falha aqui NAO derruba o tique: a posicao ja esta gravada, que e o dado
     * principal, e o proximo ponto reprocessa a partir do estado real.
     */
    for (const leitura of paraDerivar) {
      try {
        /*
         * O anterior sai da POSICAO anterior, lida agora — depois de a nova ja
         * estar gravada, e por isso a consulta usa `lt` do carimbo dela.
         */
        const anterior = await estadoAnteriorDe(leitura.rastreadorId, leitura.registradoEm);
        const d = await aplicarLeitura(leitura, anterior, {
          limiteVelocidadeKmh: config.limiteVelocidadeKmh ?? 100,
        });
        resumo.eventos += d.eventos;
        resumo.viagensAbertas += d.viagensAbertas;
        resumo.viagensFechadas += d.viagensFechadas;
      } catch (err) {
        // Um rastreador problematico nao pode calar os outros — mesma regra do
        // laco de credenciais no scheduler.
        console.error(`[rastreamento] derivacao falhou para ${leitura.rastreadorId}:`, err);
      }
    }
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
  /** Decide o pictograma do marcador — carro, moto, van, caminhao. */
  tipo: TipoVeiculo;
  provedorNome: string | null;
  lat: number;
  lng: number;
  velocidadeKmh: number | null;
  registradoEm: string;
  movendo: boolean | null;
  comunicando: boolean | null;
  /** Os tres de primeira classe, para os chips do mapa. */
  ignicao: "ligada" | "desligada" | "anomalia" | null;
  bateriaPct: number | null;
  bloqueado: boolean | null;
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
      rastreador: { select: { comunicando: true, ignicao: true, bateriaPct: true, bloqueado: true } },
      veiculo: { select: { id: true, placa: true, modelo: true, tipo: true, provedor: { select: { nome: true } } } },
    },
  });
  if (vinculos.length === 0) return [];

  const pontos = await Promise.all(
    vinculos.map((v) =>
      prisma.posicaoRastreador.findFirst({
        where: { rastreadorId: v.rastreadorId },
        orderBy: { registradoEm: "desc" },
        select: {
          lat: true,
          lng: true,
          velocidadeKmh: true,
          registradoEm: true,
          movendo: true,
          comunicando: true,
          ignicao: true,
          bateriaPct: true,
          bloqueado: true,
        },
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
      tipo: v.veiculo.tipo,
      provedorNome: v.veiculo.provedor?.nome ?? null,
      lat: p.lat,
      lng: p.lng,
      velocidadeKmh: p.velocidadeKmh,
      registradoEm: p.registradoEm.toISOString(),
      movendo: p.movendo,
      comunicando: p.comunicando ?? v.rastreador.comunicando,
      /*
       * A POSICAO primeiro, o rastreador como reserva. A posicao e a fotografia
       * daquele instante; o rastreador e o estado corrente, que pode ser mais
       * novo (o aparelho fala sem mandar fix novo). Preferir a posicao mantem o
       * chip coerente com a coordenada e a idade exibidas ao lado dele.
       */
      ignicao: p.ignicao ?? v.rastreador.ignicao,
      bateriaPct: p.bateriaPct ?? v.rastreador.bateriaPct,
      bloqueado: p.bloqueado ?? v.rastreador.bloqueado,
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


// ---------------------------------------------------------------------------
// O DIA DE UM VEICULO
// ---------------------------------------------------------------------------

export interface SensorNaTela {
  nome: string;
  rotulo: string;
  valor: string;
  resumo: string;
  severidade: "success" | "warning" | "danger" | null;
  icone: string | null;
}

export interface ViagemNaTela {
  id: string;
  inicioEm: string;
  fimEm: string | null;
  distanciaMetros: number | null;
  velocidadeMaxKmh: number | null;
  paradoComMotorLigadoSeg: number | null;
  motorista: string | null;
}

export interface EventoNaTela {
  id: string;
  tipo: EventoRastreadorTipo;
  em: string;
  detalhe: unknown;
}

export interface DiaDoVeiculo {
  agoraServidor: string;
  rastreador: {
    identificadorExterno: string;
    apelido: string | null;
    modeloFornecedor: string | null;
    nomeFornecedor: string | null;
    intervaloFornecedorSeg: number | null;
    /**
     * Se o APARELHO aceita corte de motor. Informativo: o ISPhub nao envia
     * comando nenhum — quem bloqueia e a plataforma do fornecedor, que ja tem o
     * controle e a responsabilidade.
     */
    temComandoCorte: boolean;
    instaladoEm: string | null;
    ultimaPosicaoEm: string | null;
  } | null;
  /** TODOS os sensores, ja rotulados pelo dicionario do fornecedor. */
  sensores: SensorNaTela[];
  viagens: ViagemNaTela[];
  eventos: EventoNaTela[];
}

export async function diaDoVeiculo(veiculoId: string, de: Date, ate: Date): Promise<DiaDoVeiculo> {
  const vinculo = await prisma.vinculoRastreador.findFirst({
    where: { veiculoId, fimEm: null },
    select: {
      rastreador: {
        select: {
          id: true,
          provedorId: true,
          identificadorExterno: true,
          apelido: true,
          modeloFornecedor: true,
          nomeFornecedor: true,
          intervaloFornecedorSeg: true,
          temComandoCorte: true,
          instaladoEm: true,
          ultimaPosicaoEm: true,
          sensores: true,
        },
      },
    },
  });

  const [viagens, eventos] = await Promise.all([
    prisma.viagem.findMany({
      where: { veiculoId, inicioEm: { gte: de, lte: ate } },
      orderBy: { inicioEm: "desc" },
      select: {
        id: true,
        inicioEm: true,
        fimEm: true,
        distanciaMetros: true,
        velocidadeMaxKmh: true,
        paradoComMotorLigadoSeg: true,
        ocupacao: { select: { usuario: { select: { nome: true, nomeExibicao: true } } } },
      },
    }),
    prisma.eventoRastreador.findMany({
      where: { veiculoId, em: { gte: de, lte: ate } },
      orderBy: { em: "desc" },
      take: 200,
      select: { id: true, tipo: true, em: true, detalhe: true },
    }),
  ]);

  const r = vinculo?.rastreador ?? null;
  let sensores: SensorNaTela[] = [];
  if (r) {
    /*
     * O dicionario vem da credencial DAQUELE provedor — cada conta do fornecedor
     * pode publicar sensores diferentes. Buscar o de outro provedor rotularia o
     * aparelho com o vocabulario errado.
     */
    const config = await prisma.rastreadorConfig.findFirst({
      where: { provedorId: r.provedorId },
      select: { dicionarioSensores: true },
    });
    const mapa = comoMapaSensores(r.sensores) ?? {};
    sensores = sensoresParaExibir(mapa, (config?.dicionarioSensores ?? null) as DicionarioSensores | null);
  }

  return {
    agoraServidor: new Date().toISOString(),
    rastreador: r
      ? {
          identificadorExterno: r.identificadorExterno,
          apelido: r.apelido,
          modeloFornecedor: r.modeloFornecedor,
          nomeFornecedor: r.nomeFornecedor,
          intervaloFornecedorSeg: r.intervaloFornecedorSeg,
          temComandoCorte: r.temComandoCorte,
          instaladoEm: r.instaladoEm?.toISOString() ?? null,
          ultimaPosicaoEm: r.ultimaPosicaoEm?.toISOString() ?? null,
        }
      : null,
    sensores,
    viagens: viagens.map((v) => ({
      id: v.id,
      inicioEm: v.inicioEm.toISOString(),
      fimEm: v.fimEm?.toISOString() ?? null,
      distanciaMetros: v.distanciaMetros,
      velocidadeMaxKmh: v.velocidadeMaxKmh,
      paradoComMotorLigadoSeg: v.paradoComMotorLigadoSeg,
      motorista: v.ocupacao ? (v.ocupacao.usuario.nomeExibicao || v.ocupacao.usuario.nome) : null,
    })),
    eventos: eventos.map((e) => ({ id: e.id, tipo: e.tipo, em: e.em.toISOString(), detalhe: e.detalhe })),
  };
}
