import { StatusPreset, type Jornada, type MotivoPausa, type PapelOcupacao } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
  declararColegas,
  declararDentroDaTransacao,
  ehCorridaDeMotorista,
  encerrarDentroDaTransacao,
  ocupacaoAtual,
  type AvisoOcupacao,
  type OcupacaoPublic,
} from "./ocupacaoService.js";

/**
 * Iniciar/encerrar a jornada do tecnico.
 *
 * As funcoes de calculo (duracao, formato, limite de alerta) NAO estao aqui —
 * moram em `@isphub/shared`, porque o app e o painel web exibem o mesmo numero
 * e dois calculos separados divergiriam.
 *
 * Aqui fica so o que toca o banco, e a decisao que o banco sozinho nao toma:
 * o acoplamento com o status do perfil.
 */

/** Coordenada opcional do momento — permissao negada nao impede a acao. */
export interface Geo {
  lat?: number | null;
  lng?: number | null;
}

const CAMPOS = {
  id: true,
  inicioEm: true,
  fimEm: true,
  latInicio: true,
  lngInicio: true,
  latFim: true,
  lngFim: true,
  // Em ordem de inicio: a tela mostra a sequencia do dia, e "a ultima pausa"
  // so faz sentido se a ordem for a mesma em todo lugar.
  pausas: { select: { id: true, inicioEm: true, fimEm: true, motivo: true }, orderBy: { inicioEm: "asc" } },
} as const;

type LinhaPausa = { id: string; inicioEm: Date; fimEm: Date | null; motivo: MotivoPausa };

type LinhaJornada = {
  id: string;
  inicioEm: Date;
  fimEm: Date | null;
  latInicio: number | null;
  lngInicio: number | null;
  latFim: number | null;
  lngFim: number | null;
  pausas?: LinhaPausa[];
};

/** Datas viram ISO na fronteira da API — o resto do sistema so ve string. */
export function serializar(j: LinhaJornada): Jornada {
  return {
    id: j.id,
    inicioEm: j.inicioEm.toISOString(),
    fimEm: j.fimEm ? j.fimEm.toISOString() : null,
    latInicio: j.latInicio,
    lngInicio: j.lngInicio,
    latFim: j.latFim,
    lngFim: j.lngFim,
    pausas: (j.pausas ?? []).map((p) => ({
      id: p.id,
      inicioEm: p.inicioEm.toISOString(),
      fimEm: p.fimEm ? p.fimEm.toISOString() : null,
      motivo: p.motivo,
    })),
  };
}

/** A jornada aberta deste tecnico, se houver. */
export async function jornadaAtual(usuarioId: string): Promise<Jornada | null> {
  const j = await prisma.jornadaTecnico.findFirst({
    where: { usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: CAMPOS,
  });
  return j ? serializar(j) : null;
}

/**
 * Comeca o turno — e e IDEMPOTENTE: se ja houver uma aberta, devolve aquela.
 *
 * Um toque duplo no botao (comum com luva, e com a rede lenta o botao demora a
 * responder) nao pode gerar duas jornadas. A checagem aqui resolve o caso
 * normal; o indice parcial `jornadas_tecnico_uma_aberta_por_usuario` resolve a
 * CORRIDA que a checagem nao cobre — dois pedidos simultaneos passam os dois
 * pelo `findFirst` e so um sobrevive ao INSERT.
 */
export interface ViaturaArgs {
  /**
   * OPCIONAL, e isso e regra: tecnico a pe, de moto propria ou de carona abre
   * turno igual. Mesmo principio do geo — a viatura e complemento da acao,
   * nunca requisito dela.
   */
  veiculoId?: string | null;
  papel?: PapelOcupacao;
  odometro?: number | null;
  /** Quem vai junto. Teto de 6: e um carro. */
  colegas?: { usuarioId: string; papel: PapelOcupacao }[];
}

export interface ResultadoJornada {
  jornada: Jornada;
  ocupacao: OcupacaoPublic | null;
  avisos: AvisoOcupacao[];
}

export async function iniciarJornada(usuarioId: string, geo: Geo = {}, viatura: ViaturaArgs = {}): Promise<ResultadoJornada> {
  const aberta = await jornadaAtual(usuarioId);
  /*
   * ATENCAO ao retorno antecipado: antes ele devolvia a jornada e pronto. Com
   * viatura no corpo, isso DESCARTARIA o veiculo em silencio — o tecnico
   * escolheria a viatura, a tela nao reclamaria, e a ocupacao nunca existiria.
   * Agora a jornada nao e recriada, mas a viatura e aplicada do mesmo jeito.
   */
  if (aberta) return aplicarViatura(usuarioId, aberta, geo, viatura);

  try {
    /*
     * Jornada e status na MESMA transacao. Separados, dava pra ficar com
     * jornada aberta e status "Indisponivel" — e ai nenhuma das duas
     * informacoes vale, porque o gestor nao sabe em qual acreditar.
     */
    const [j] = await prisma.$transaction([
      prisma.jornadaTecnico.create({
        data: { usuarioId, latInicio: geo.lat ?? null, lngInicio: geo.lng ?? null },
        select: CAMPOS,
      }),
      prisma.usuario.update({ where: { id: usuarioId }, data: { status: StatusPreset.DISPONIVEL } }),
    ]);
    return aplicarViatura(usuarioId, serializar(j), geo, viatura);
  } catch (e) {
    /*
     * P2002 = violacao de unicidade: a corrida acima aconteceu de verdade e o
     * outro pedido ganhou. O certo NAO e erro — o tecnico queria estar em
     * jornada, e esta. Devolve a que venceu.
     */
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      const existente = await jornadaAtual(usuarioId);
      if (existente) return aplicarViatura(usuarioId, existente, geo, viatura);
    }
    throw e;
  }
}

/**
 * Aplica a viatura declarada — e os colegas.
 *
 * DUAS transacoes, e isso nao e descuido. No Postgres, um statement que falha
 * dentro de uma transacao ENVENENA a transacao inteira ("current transaction is
 * aborted"): um try/catch em volta do insert de um colega, ali dentro, nao
 * salvaria nada — o resto do bloco morre junto.
 *
 * O desenho tambem esta certo por si. A linha do Pedro nao faz parte do fato
 * atomico do Joao: o turno do Joao e verdade com ou sem ela. Abortar o turno
 * inteiro porque o Pedro tocou no mesmo milissegundo seria a troca errada toda
 * vez — o tecnico ficaria na porta do cliente sem conseguir bater o inicio.
 */
async function aplicarViatura(
  usuarioId: string,
  jornada: Jornada,
  geo: Geo,
  viatura: ViaturaArgs,
): Promise<ResultadoJornada> {
  if (!viatura.veiculoId) {
    return { jornada, ocupacao: await ocupacaoAtual(usuarioId), avisos: [] };
  }

  // Tx1: SO a ocupacao de quem chamou. Um fato so.
  const base = {
    usuarioId,
    veiculoId: viatura.veiculoId,
    origem: "jornada" as const,
    declaradoPorId: usuarioId,
    jornadaId: jornada.id,
    odometro: viatura.odometro,
    lat: geo.lat,
    lng: geo.lng,
  };
  let propria;
  try {
    propria = await prisma.$transaction((tx) =>
      declararDentroDaTransacao(tx, { ...base, papel: viatura.papel ?? "motorista" }),
    );
  } catch (e) {
    /*
     * A CORRIDA: outro tecnico virou motorista deste carro entre a checagem e o
     * insert. A retentativa e FORA da transacao anterior — dentro dela nao
     * adiantaria, porque o Postgres ja a abortou por inteiro.
     */
    if (!ehCorridaDeMotorista(e)) throw e;
    propria = await prisma.$transaction((tx) => declararDentroDaTransacao(tx, { ...base, papel: "passageiro" }));
    propria.aviso = {
      codigo: "motorista_ja_declarado",
      mensagem: "Já há um motorista declarado nesta viatura — você entrou como passageiro.",
      usuarioId,
    };
  }

  // Depois, um por um, cada qual com o proprio try/catch.
  const avisos = await declararColegas(viatura.colegas ?? [], {
    veiculoId: viatura.veiculoId,
    declaradoPorId: usuarioId,
    jornadaId: jornada.id,
    odometro: viatura.odometro,
    lat: geo.lat,
    lng: geo.lng,
  });

  return {
    jornada,
    ocupacao: propria.ocupacao,
    avisos: [...(propria.aviso ? [propria.aviso] : []), ...avisos],
  };
}

/**
 * Troca de viatura NO MEIO do turno — o caso do tecnico que muda de carro as
 * 13:30 sem encerrar a jornada.
 *
 * A jornada nao e tocada: `inicioEm` continua o mesmo, e as duas ocupacoes
 * carregam o mesmo `jornadaId`. O historico mostra DOIS trechos, em vez de o
 * segundo sobrescrever o primeiro — que e exatamente onde os sistemas de
 * referencia perdem a informacao.
 *
 * `veiculoId: null` significa "sai do veiculo" e apenas fecha.
 */
export async function trocarViatura(
  usuarioId: string,
  geo: Geo = {},
  viatura: ViaturaArgs = {},
): Promise<ResultadoJornada> {
  const jornada = await jornadaAtual(usuarioId);
  if (!jornada) throw new HttpError(409, "Nenhuma jornada aberta — inicie o turno antes de declarar a viatura.");

  if (!viatura.veiculoId) {
    const fechada = await prisma.$transaction((tx) =>
      encerrarDentroDaTransacao(tx, usuarioId, "troca_veiculo", geo, viatura.odometro),
    );
    return { jornada, ocupacao: fechada ? null : null, avisos: [] };
  }
  return aplicarViatura(usuarioId, jornada, geo, viatura);
}

/**
 * Encerra o turno aberto.
 *
 * 409 e nao 404: o pedido esta bem formado e o recurso existe — o que nao bate
 * e o ESTADO (nao ha turno aberto pra fechar). Normalmente significa que o
 * tecnico tocou duas vezes, entao a mensagem fala a lingua dele.
 */
export async function encerrarJornada(usuarioId: string, geo: Geo = {}): Promise<Jornada> {
  const aberta = await prisma.jornadaTecnico.findFirst({
    where: { usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: { id: true },
  });
  if (!aberta) throw new HttpError(409, "Nenhuma jornada aberta para encerrar.");

  return prisma.$transaction(async (tx) => {
    const j = await tx.jornadaTecnico.update({
      where: { id: aberta.id },
      data: { fimEm: new Date(), latFim: geo.lat ?? null, lngFim: geo.lng ?? null },
      select: CAMPOS,
    });
    await tx.usuario.update({ where: { id: usuarioId }, data: { status: StatusPreset.INDISPONIVEL } });
    // Encerrar o turno fecha a ocupacao junto: ninguem continua "dentro da
    // viatura" depois de bater a saida. Devolve null quando nao havia — quem
    // foi a pe encerra igual, e isso nao e erro.
    await encerrarDentroDaTransacao(tx, usuarioId, "jornada", geo);
    return serializar(j);
  });
}

/**
 * Quem esta em servico agora — a visao do gestor.
 *
 * Sem paginacao de proposito: o teto natural e o numero de tecnicos da empresa,
 * e uma lista que precisasse paginar ja nao caberia numa tela de acompanhamento.
 */
export async function jornadasAtivas() {
  const linhas = await prisma.jornadaTecnico.findMany({
    where: { fimEm: null },
    orderBy: { inicioEm: "asc" },
    select: {
      inicioEm: true,
      usuario: { select: { id: true, nome: true, nomeExibicao: true, temFoto: true, fotoVersao: true } },
    },
  });
  return linhas.map((l) => ({
    usuarioId: l.usuario.id,
    nome: l.usuario.nome,
    nomeExibicao: l.usuario.nomeExibicao,
    temFoto: l.usuario.temFoto,
    fotoVersao: l.usuario.fotoVersao,
    inicioEm: l.inicioEm.toISOString(),
  }));
}


/**
 * Comeca uma pausa (almoco, por padrao).
 *
 * O indice parcial `pausas_jornada_uma_aberta` e quem de fato garante UMA
 * pausa aberta por jornada — dois toques rapidos no botao, ou dois aparelhos,
 * batem no banco e nao numa checagem de aplicacao que pode perder a corrida.
 * A consulta abaixo existe pra dar mensagem decente, nao pra ser a garantia.
 */
export async function pausarJornada(usuarioId: string, motivo: MotivoPausa = "almoco"): Promise<Jornada> {
  const aberta = await prisma.jornadaTecnico.findFirst({
    where: { usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: { id: true },
  });
  if (!aberta) throw new HttpError(409, "Nenhuma jornada aberta para pausar");

  try {
    await prisma.pausaJornada.create({ data: { jornadaId: aberta.id, motivo } });
  } catch {
    // Violacao do indice parcial = ja havia pausa aberta. Nao e erro do
    // usuario: ele tocou duas vezes, ou o app repetiu a chamada sem rede.
    throw new HttpError(409, "Esta jornada ja esta em pausa");
  }

  return serializar(
    (await prisma.jornadaTecnico.findUniqueOrThrow({ where: { id: aberta.id }, select: CAMPOS })) as LinhaJornada,
  );
}

/** Fecha a pausa aberta e volta a contar o tempo trabalhado. */
export async function retomarJornada(usuarioId: string): Promise<Jornada> {
  const aberta = await prisma.jornadaTecnico.findFirst({
    where: { usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: { id: true, pausas: { where: { fimEm: null }, select: { id: true } } },
  });
  if (!aberta) throw new HttpError(409, "Nenhuma jornada aberta");
  const pausa = aberta.pausas[0];
  if (!pausa) throw new HttpError(409, "Esta jornada nao esta em pausa");

  await prisma.pausaJornada.update({ where: { id: pausa.id }, data: { fimEm: new Date() } });
  return serializar(
    (await prisma.jornadaTecnico.findUniqueOrThrow({ where: { id: aberta.id }, select: CAMPOS })) as LinhaJornada,
  );
}
