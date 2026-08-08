import {
  decidirOcupacao,
  type OrigemOcupacao,
  type PapelOcupacao,
} from "@isphub/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * Quem esta em qual viatura, e desde quando.
 *
 * O modelo que este service protege: a ocupacao e um PERIODO, uma linha por
 * pessoa. O ERP de referencia guarda `current_driver_id`, uma coluna mutavel
 * unica — um abastecimento do mes passado resolve pro motorista de HOJE. O
 * Maxxi guarda `tecnico_veiculo_dia` com PK so no agente, entao a atribuicao de
 * hoje SOBRESCREVE a de ontem. Os dois perdem o passado.
 *
 * A regra de "quem vence" e pura e mora em `@isphub/shared` (`decidirOcupacao`),
 * porque app e servidor precisam concordar. Aqui fica so o que toca o banco.
 */

export interface AvisoOcupacao {
  codigo: "colega_ja_declarado" | "motorista_ja_declarado" | "falha_ao_declarar";
  /** Mensagem pronta pra tela — quem le e o tecnico, no meio da rua. */
  mensagem: string;
  usuarioId: string;
}

const SELECT = {
  id: true,
  veiculoId: true,
  usuarioId: true,
  inicioEm: true,
  fimEm: true,
  papel: true,
  origem: true,
  declaradoPorId: true,
  odometroInicio: true,
  odometroFim: true,
  veiculo: { select: { placa: true, modelo: true } },
  usuario: { select: { nome: true, nomeExibicao: true } },
  declaradoPor: { select: { nome: true, nomeExibicao: true } },
} satisfies Prisma.OcupacaoVeiculoSelect;

type Linha = Prisma.OcupacaoVeiculoGetPayload<{ select: typeof SELECT }>;

export interface OcupacaoPublic {
  id: string;
  veiculoId: string;
  veiculoPlaca: string;
  veiculoModelo: string;
  usuarioId: string;
  usuarioNome: string;
  papel: PapelOcupacao;
  origem: OrigemOcupacao;
  declaradoPorNome: string;
  inicioEm: string;
  fimEm: string | null;
  odometroInicio: number | null;
  odometroFim: number | null;
}

export function serializar(o: Linha): OcupacaoPublic {
  return {
    id: o.id,
    veiculoId: o.veiculoId,
    veiculoPlaca: o.veiculo.placa,
    veiculoModelo: o.veiculo.modelo,
    usuarioId: o.usuarioId,
    usuarioNome: o.usuario.nomeExibicao || o.usuario.nome,
    papel: o.papel,
    origem: o.origem,
    declaradoPorNome: o.declaradoPor.nomeExibicao || o.declaradoPor.nome,
    inicioEm: o.inicioEm.toISOString(),
    fimEm: o.fimEm ? o.fimEm.toISOString() : null,
    odometroInicio: o.odometroInicio,
    odometroFim: o.odometroFim,
  };
}

/** A ocupacao aberta desta pessoa, se houver. O indice parcial garante <= 1. */
export async function ocupacaoAtual(usuarioId: string): Promise<OcupacaoPublic | null> {
  const o = await prisma.ocupacaoVeiculo.findFirst({
    where: { usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: SELECT,
  });
  return o ? serializar(o) : null;
}

/** Quem esta dentro de cada viatura AGORA — alimenta o seletor do app. */
export async function ocupantesAbertos(veiculoIds?: string[]): Promise<OcupacaoPublic[]> {
  const linhas = await prisma.ocupacaoVeiculo.findMany({
    where: { fimEm: null, ...(veiculoIds ? { veiculoId: { in: veiculoIds } } : {}) },
    orderBy: [{ veiculoId: "asc" }, { inicioEm: "asc" }],
    select: SELECT,
  });
  return linhas.map(serializar);
}

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface DeclararArgs {
  usuarioId: string;
  veiculoId: string;
  papel: PapelOcupacao;
  origem: OrigemOcupacao;
  declaradoPorId: string;
  jornadaId?: string | null;
  odometro?: number | null;
  lat?: number | null;
  lng?: number | null;
}

type Resultado = { ocupacao: OcupacaoPublic | null; aviso: AvisoOcupacao | null };

/**
 * Declara que alguem esta num veiculo — a operacao central do modulo.
 *
 * Roda DENTRO de uma transacao que o chamador abre, porque fechar a anterior e
 * abrir a nova tem de ser um fato so: no meio, a pessoa estaria em dois carros
 * (e o indice parcial recusaria) ou em nenhum.
 */
export async function declararDentroDaTransacao(tx: Tx, args: DeclararArgs): Promise<Resultado> {
  const atual = await tx.ocupacaoVeiculo.findFirst({
    where: { usuarioId: args.usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: { id: true, veiculoId: true, papel: true, origem: true },
  });

  const decisao = decidirOcupacao(atual, {
    veiculoId: args.veiculoId,
    papel: args.papel,
    origem: args.origem,
  });

  if (decisao.tipo === "manter") {
    const igual = await tx.ocupacaoVeiculo.findUnique({ where: { id: atual!.id }, select: SELECT });
    return { ocupacao: igual ? serializar(igual) : null, aviso: null };
  }

  if (decisao.tipo === "recusar") {
    /*
     * Uma declaracao mais fraca nao desloca uma mais forte: o colega nao move
     * quem ja se declarou. NUNCA erro duro — o turno de quem chamou abre do
     * mesmo jeito, e a tela dele mostra o aviso.
     */
    const dono = await tx.ocupacaoVeiculo.findUnique({
      where: { id: decisao.ocupacaoIdAtual },
      select: { usuario: { select: { nome: true, nomeExibicao: true } }, veiculo: { select: { placa: true } } },
    });
    const nome = dono ? dono.usuario.nomeExibicao || dono.usuario.nome : "O colega";
    return {
      ocupacao: null,
      aviso: {
        codigo: "colega_ja_declarado",
        mensagem: `${nome} já declarou que está no ${dono?.veiculo.placa ?? "outro veículo"}.`,
        usuarioId: args.usuarioId,
      },
    };
  }

  if (decisao.tipo === "mover") {
    await tx.ocupacaoVeiculo.update({
      where: { id: decisao.fecharOcupacaoId },
      data: {
        fimEm: new Date(),
        encerradoPor: "troca_veiculo",
        odometroFim: args.odometro ?? null,
        latFim: args.lat ?? null,
        lngFim: args.lng ?? null,
      },
    });
  }

  /*
   * DOIS motoristas no mesmo carro nao existem (indice parcial
   * `um_motorista_aberto_por_veiculo`). Mas isso NAO pode barrar o turno de
   * ninguem: quem chega depois entra como passageiro, com aviso e acao de
   * trocar na tela.
   *
   * A checagem vem ANTES do insert, e nao num catch de P2002, por uma razao
   * dura do Postgres: um statement que falha ENVENENA a transacao inteira
   * ("current transaction is aborted"). Um `catch` aqui dentro pegaria o erro,
   * mas o INSERT seguinte morreria junto — foi exatamente o que aconteceu na
   * primeira versao, e virou 500 na troca de viatura.
   *
   * O indice segue sendo a rede pra CORRIDA (dois toques no mesmo
   * milissegundo); esse caso propaga, e quem chama retenta uma vez.
   */
  let papel = args.papel;
  let aviso: AvisoOcupacao | null = null;
  if (papel === "motorista") {
    const jaHaMotorista = await tx.ocupacaoVeiculo.findFirst({
      where: { veiculoId: args.veiculoId, fimEm: null, papel: "motorista" },
      select: { id: true },
    });
    if (jaHaMotorista) {
      papel = "passageiro";
      aviso = {
        codigo: "motorista_ja_declarado",
        mensagem: "Já há um motorista declarado nesta viatura — você entrou como passageiro.",
        usuarioId: args.usuarioId,
      };
    }
  }

  const nova = await tx.ocupacaoVeiculo.create({
    data: {
      veiculoId: args.veiculoId,
      usuarioId: args.usuarioId,
      papel,
      origem: args.origem,
      declaradoPorId: args.declaradoPorId,
      jornadaId: args.jornadaId ?? null,
      odometroInicio: args.odometro ?? null,
      latInicio: args.lat ?? null,
      lngInicio: args.lng ?? null,
    },
    select: SELECT,
  });
  return { ocupacao: serializar(nova), aviso };
}

/** A corrida de verdade: dois motoristas declarados no mesmo milissegundo. */
export function ehCorridaDeMotorista(e: unknown): boolean {
  return !!e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002";
}

/**
 * Fecha a ocupacao aberta de alguem. Devolve `null` quando nao havia — nao e
 * erro: encerrar turno sem ter declarado viatura e o caso comum de quem foi a pe.
 */
export async function encerrarDentroDaTransacao(
  tx: Tx,
  usuarioId: string,
  motivo: "jornada" | "troca_veiculo" | "ajuste",
  geo: { lat?: number | null; lng?: number | null } = {},
  odometro?: number | null,
): Promise<OcupacaoPublic | null> {
  const aberta = await tx.ocupacaoVeiculo.findFirst({
    where: { usuarioId, fimEm: null },
    orderBy: { inicioEm: "desc" },
    select: { id: true },
  });
  if (!aberta) return null;

  const fechada = await tx.ocupacaoVeiculo.update({
    where: { id: aberta.id },
    data: {
      fimEm: new Date(),
      encerradoPor: motivo,
      odometroFim: odometro ?? null,
      latFim: geo.lat ?? null,
      lngFim: geo.lng ?? null,
    },
    select: SELECT,
  });
  return serializar(fechada);
}

/**
 * Declara os COLEGAS — uma escrita pequena por pessoa, cada uma com o proprio
 * try/catch, e FORA da transacao do autor.
 *
 * A razao e uma armadilha do Postgres: um statement que falha dentro de uma
 * transacao ENVENENA a transacao inteira ("current transaction is aborted"), e
 * ai o try/catch em volta nao adianta — o resto do bloco morre junto.
 *
 * O desenho tambem esta certo por si: a linha do Pedro nao faz parte do fato
 * atomico do Joao. O turno do Joao e verdade com ou sem ela, e abortar tudo
 * porque o Pedro tocou no mesmo milissegundo seria a troca errada toda vez.
 */
export async function declararColegas(
  colegas: { usuarioId: string; papel: PapelOcupacao }[],
  base: Omit<DeclararArgs, "usuarioId" | "papel" | "origem">,
): Promise<AvisoOcupacao[]> {
  const avisos: AvisoOcupacao[] = [];
  for (const c of colegas) {
    if (c.usuarioId === base.declaradoPorId) continue; // quem declarou ja tem a propria
    try {
      const r = await prisma.$transaction((tx) =>
        declararDentroDaTransacao(tx, {
          ...base,
          usuarioId: c.usuarioId,
          papel: c.papel,
          origem: "declaracao",
        }),
      );
      if (r.aviso) avisos.push(r.aviso);
    } catch (err) {
      console.error("[ocupacao] falha ao declarar colega:", err);
      avisos.push({
        codigo: "falha_ao_declarar",
        mensagem: "Não foi possível registrar um dos colegas na viatura.",
        usuarioId: c.usuarioId,
      });
    }
  }
  return avisos;
}

// ---------------------------------------------------------------------------
// AS PERGUNTAS QUE O MODULO EXISTE PRA RESPONDER
// ---------------------------------------------------------------------------

/**
 * Intervalo SEMIABERTO `[inicioEm, fimEm)`.
 *
 * Numa troca as 13:30 em ponto, com intervalo fechado dos dois lados a pessoa
 * estaria nos DOIS carros — e "quem estava no carro" perderia a resposta unica
 * exatamente no momento que mais interessa.
 */
function cobrindo(instante: Date) {
  return {
    inicioEm: { lte: instante },
    OR: [{ fimEm: null }, { fimEm: { gt: instante } }],
  };
}

/** "Quem estava na HFX3652 as 14:30?" — indice (veiculoId, inicioEm). */
export async function ocupantesEm(veiculoId: string, instante: Date): Promise<OcupacaoPublic[]> {
  const linhas = await prisma.ocupacaoVeiculo.findMany({
    where: { veiculoId, ...cobrindo(instante) },
    orderBy: { inicioEm: "asc" },
    select: SELECT,
  });
  return linhas.map(serializar);
}

/** "Qual veiculo o Joao usava as 15:00?" — indice (usuarioId, inicioEm). */
export async function veiculoDe(usuarioId: string, instante: Date): Promise<OcupacaoPublic | null> {
  const o = await prisma.ocupacaoVeiculo.findFirst({
    where: { usuarioId, ...cobrindo(instante) },
    orderBy: { inicioEm: "desc" },
    select: SELECT,
  });
  return o ? serializar(o) : null;
}

export interface VeiculoDaOs {
  ocupacao: OcupacaoPublic;
  /** `explicito` = alguem afirmou; `derivado` = inferido pelo horario. */
  fonte: "explicito" | "derivado";
}

/**
 * "Qual veiculo fez a OS #12345?"
 *
 * Devolve LISTA, e isso importa: se o tecnico trocou de carro no meio da OS,
 * DOIS veiculos fizeram aquela OS, e reduzir a um seria mentira.
 *
 * Duas fontes, explicita primeiro. A derivada e o caso normal — cruza a janela
 * de execucao da OS (min/max dos eventos) com as ocupacoes do tecnico dela. Uma
 * FK obrigatoria seria uma quarta verdade a manter em dia.
 */
export async function veiculosDaOs(ordemServicoId: string): Promise<VeiculoDaOs[]> {
  const explicitas = await prisma.ocupacaoVeiculo.findMany({
    where: { ordemServicoId },
    orderBy: { inicioEm: "asc" },
    select: SELECT,
  });
  if (explicitas.length > 0) {
    return explicitas.map((o) => ({ ocupacao: serializar(o), fonte: "explicito" as const }));
  }

  const os = await prisma.ordemServico.findUnique({
    where: { id: ordemServicoId },
    select: { tecnicoId: true, criadoEm: true, atualizadoEm: true },
  });
  if (!os?.tecnicoId) return [];

  const janela = await prisma.osEvento.aggregate({
    where: { ordemServicoId },
    _min: { criadoEm: true },
    _max: { criadoEm: true },
  });
  const de = janela._min.criadoEm ?? os.criadoEm;
  const ate = janela._max.criadoEm ?? os.atualizadoEm;

  // Sobreposicao de intervalos: comeca antes do fim E termina depois do inicio.
  const derivadas = await prisma.ocupacaoVeiculo.findMany({
    where: {
      usuarioId: os.tecnicoId,
      inicioEm: { lte: ate },
      OR: [{ fimEm: null }, { fimEm: { gt: de } }],
    },
    orderBy: { inicioEm: "asc" },
    select: SELECT,
  });
  return derivadas.map((o) => ({ ocupacao: serializar(o), fonte: "derivado" as const }));
}

/** Historico de um veiculo — quem passou por ele. */
export async function historicoDoVeiculo(veiculoId: string, de: Date, ate: Date): Promise<OcupacaoPublic[]> {
  const linhas = await prisma.ocupacaoVeiculo.findMany({
    where: { veiculoId, inicioEm: { lte: ate }, OR: [{ fimEm: null }, { fimEm: { gt: de } }] },
    orderBy: { inicioEm: "desc" },
    select: SELECT,
  });
  return linhas.map(serializar);
}

/** Ajuste manual do gestor — fecha uma ocupacao que ficou aberta. */
export async function encerrarPorAjuste(id: string): Promise<OcupacaoPublic> {
  const aberta = await prisma.ocupacaoVeiculo.findUnique({ where: { id }, select: { fimEm: true } });
  if (!aberta) throw new HttpError(404, "Ocupacao nao encontrada");
  if (aberta.fimEm) throw new HttpError(409, "Esta ocupacao ja foi encerrada");
  const fechada = await prisma.ocupacaoVeiculo.update({
    where: { id },
    data: { fimEm: new Date(), encerradoPor: "ajuste" },
    select: SELECT,
  });
  return serializar(fechada);
}
