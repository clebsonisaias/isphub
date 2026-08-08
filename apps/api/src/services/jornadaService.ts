import { StatusPreset, type Jornada } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

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

const CAMPOS: { id: true; inicioEm: true; fimEm: true; latInicio: true; lngInicio: true; latFim: true; lngFim: true } = {
  id: true,
  inicioEm: true,
  fimEm: true,
  latInicio: true,
  lngInicio: true,
  latFim: true,
  lngFim: true,
};

type LinhaJornada = {
  id: string;
  inicioEm: Date;
  fimEm: Date | null;
  latInicio: number | null;
  lngInicio: number | null;
  latFim: number | null;
  lngFim: number | null;
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
export async function iniciarJornada(usuarioId: string, geo: Geo = {}): Promise<Jornada> {
  const aberta = await jornadaAtual(usuarioId);
  if (aberta) return aberta;

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
    return serializar(j);
  } catch (e) {
    /*
     * P2002 = violacao de unicidade: a corrida acima aconteceu de verdade e o
     * outro pedido ganhou. O certo NAO e erro — o tecnico queria estar em
     * jornada, e esta. Devolve a que venceu.
     */
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      const existente = await jornadaAtual(usuarioId);
      if (existente) return existente;
    }
    throw e;
  }
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

  const [j] = await prisma.$transaction([
    prisma.jornadaTecnico.update({
      where: { id: aberta.id },
      data: { fimEm: new Date(), latFim: geo.lat ?? null, lngFim: geo.lng ?? null },
      select: CAMPOS,
    }),
    prisma.usuario.update({ where: { id: usuarioId }, data: { status: StatusPreset.INDISPONIVEL } }),
  ]);
  return serializar(j);
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
