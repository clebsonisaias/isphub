import { UserRole, type PapelOcupacao, type TecnicoComViaturaFixa, type ViaturaFixaPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { declararDentroDaTransacao, encerrarDentroDaTransacao } from "./ocupacaoService.js";

/**
 * O carro FIXO de cada tecnico — quem decide e o gestor.
 *
 * Na operacao, cada tecnico tem o seu carro; trocar e excecao. Entao o padrao
 * mora aqui e a excecao do dia mora na `EscalaJornada`. Ordem na abertura do
 * turno: escala do dia > viatura fixa > o que o app mandar (ver
 * `escalaService.escalaDoTecnico`).
 */

const SELECT = {
  id: true,
  usuarioId: true,
  veiculoId: true,
  papel: true,
  inicioEm: true,
  fimEm: true,
  definidoPor: true,
  encerradoPor: true,
  observacao: true,
  usuario: { select: { nome: true, nomeExibicao: true } },
  veiculo: { select: { placa: true, apelido: true } },
} as const;

type Linha = {
  id: string;
  usuarioId: string;
  veiculoId: string;
  papel: PapelOcupacao;
  inicioEm: Date;
  fimEm: Date | null;
  definidoPor: string;
  encerradoPor: string | null;
  observacao: string | null;
  usuario: { nome: string; nomeExibicao: string | null };
  veiculo: { placa: string; apelido: string | null };
};

/** Nomes de quem definiu/encerrou. Sem FK na tabela, entao busca em lote. */
async function nomesDe(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (unicos.length === 0) return new Map();
  const us = await prisma.usuario.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nome: true, nomeExibicao: true },
  });
  return new Map(us.map((u) => [u.id, u.nomeExibicao || u.nome]));
}

function serializar(l: Linha, nomes: Map<string, string>): ViaturaFixaPublic {
  return {
    id: l.id,
    usuarioId: l.usuarioId,
    usuarioNome: l.usuario.nomeExibicao || l.usuario.nome,
    veiculoId: l.veiculoId,
    veiculoPlaca: l.veiculo.placa,
    veiculoApelido: l.veiculo.apelido,
    papel: l.papel,
    inicioEm: l.inicioEm.toISOString(),
    fimEm: l.fimEm ? l.fimEm.toISOString() : null,
    definidoPor: l.definidoPor,
    definidoPorNome: nomes.get(l.definidoPor) ?? null,
    encerradoPor: l.encerradoPor,
    encerradoPorNome: l.encerradoPor ? (nomes.get(l.encerradoPor) ?? null) : null,
    observacao: l.observacao,
  };
}

async function serializarLista(linhas: Linha[]): Promise<ViaturaFixaPublic[]> {
  const nomes = await nomesDe(linhas.flatMap((l) => [l.definidoPor, l.encerradoPor]));
  return linhas.map((l) => serializar(l, nomes));
}

/** O carro fixo vigente do tecnico, ou null. */
export async function vigenteDe(usuarioId: string): Promise<ViaturaFixaPublic | null> {
  const l = await prisma.viaturaFixa.findFirst({ where: { usuarioId, fimEm: null }, select: SELECT });
  return l ? (await serializarLista([l]))[0]! : null;
}

/** Quem tem este carro como fixo hoje (pode ser mais de um: dupla). */
export async function vigentesDoVeiculo(veiculoId: string): Promise<ViaturaFixaPublic[]> {
  const ls = await prisma.viaturaFixa.findMany({
    where: { veiculoId, fimEm: null },
    orderBy: [{ papel: "asc" }, { inicioEm: "asc" }],
    select: SELECT,
  });
  return serializarLista(ls);
}

/** Todos os periodos deste carro, do mais recente pro mais antigo. */
export async function historicoDoVeiculo(veiculoId: string, limite = 50): Promise<ViaturaFixaPublic[]> {
  const ls = await prisma.viaturaFixa.findMany({
    where: { veiculoId },
    orderBy: { inicioEm: "desc" },
    take: limite,
    select: SELECT,
  });
  return serializarLista(ls);
}

/**
 * O quadro do gestor: cada tecnico ativo com o carro fixo dele.
 *
 * `veiculoVisivel` filtra o escopo do gestor limitado: o carro de outro
 * provedor aparece como "sem carro" pra ele, em vez de vazar a placa.
 */
export async function quadro(veiculoVisivel: (provedorId: string | null) => boolean): Promise<TecnicoComViaturaFixa[]> {
  const tecnicos = await prisma.usuario.findMany({
    where: { role: UserRole.TECNICO, ativo: true },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, nomeExibicao: true },
  });
  const vigentes = await prisma.viaturaFixa.findMany({
    where: { fimEm: null, usuarioId: { in: tecnicos.map((t) => t.id) } },
    select: { ...SELECT, veiculo: { select: { placa: true, apelido: true, provedorId: true } } },
  });
  const visiveis = vigentes.filter((v) => veiculoVisivel(v.veiculo.provedorId));
  const serial = await serializarLista(visiveis);
  const porUsuario = new Map(serial.map((v) => [v.usuarioId, v]));
  return tecnicos.map((t) => ({
    usuarioId: t.id,
    nome: t.nomeExibicao || t.nome,
    viatura: porUsuario.get(t.id) ?? null,
  }));
}

export interface DefinirArgs {
  usuarioId: string;
  /** Nulo = tirar o carro fixo (o tecnico fica sem). */
  veiculoId: string | null;
  papel: PapelOcupacao;
  definidoPor: string;
  observacao?: string | null;
}

/** O que `definir` fez, pra tela dizer ao gestor sem adivinhar. */
export interface ResultadoDefinir {
  viatura: ViaturaFixaPublic | null;
  /**
   * `true` quando o tecnico estava em turno e a ocupacao foi movida JA pro
   * carro novo. `false` quando nao estava em turno, ou quando ha escala hoje
   * (a escala do dia vence o carro fixo, entao a troca so vale a partir de
   * amanha).
   */
  aplicadoAgora: boolean;
  motivoNaoAplicado: "sem_jornada" | "escala_hoje" | null;
}

/**
 * Define (ou troca, ou tira) o carro fixo de um tecnico.
 *
 * Fecha o vigente e abre outro na MESMA transacao: no meio, o tecnico estaria
 * com dois carros (o indice parcial recusaria) ou com nenhum.
 *
 * Se o tecnico esta em turno agora e nao ha escala hoje, a ocupacao aberta e
 * movida pro carro novo como `ajuste` — a declaracao mais forte. E o "fulano
 * esta no carro tal" do gestor valendo na hora, sem esperar o proximo turno.
 */
export async function definir(args: DefinirArgs): Promise<ResultadoDefinir> {
  const tecnico = await prisma.usuario.findUnique({
    where: { id: args.usuarioId },
    select: { role: true, ativo: true },
  });
  if (!tecnico) throw new HttpError(404, "Tecnico nao encontrado");
  if (tecnico.role !== UserRole.TECNICO) throw new HttpError(422, "So tecnico tem carro fixo");
  if (!tecnico.ativo) throw new HttpError(409, "Usuario inativo nao recebe carro fixo");

  if (args.veiculoId) {
    const v = await prisma.veiculo.findUnique({ where: { id: args.veiculoId }, select: { status: true } });
    if (!v) throw new HttpError(404, "Veiculo nao encontrado");
    // Manutencao e permitido: e passageira, o carro continua sendo DELE. Na
    // hora de sair, a jornada cai pro "sem carro" e o gestor escala outro.
    if (v.status === "inativo") throw new HttpError(409, "Veiculo inativo nao pode ser carro fixo");
  }

  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    const atual = await tx.viaturaFixa.findFirst({
      where: { usuarioId: args.usuarioId, fimEm: null },
      select: { id: true, veiculoId: true, papel: true },
    });
    // Mesma coisa de novo: nao gera historico vazio.
    if (atual && atual.veiculoId === args.veiculoId && atual.papel === args.papel) return;
    if (atual) {
      await tx.viaturaFixa.update({
        where: { id: atual.id },
        data: { fimEm: agora, encerradoPor: args.definidoPor },
      });
    }
    if (args.veiculoId) {
      await tx.viaturaFixa.create({
        data: {
          usuarioId: args.usuarioId,
          veiculoId: args.veiculoId,
          papel: args.papel,
          inicioEm: agora,
          definidoPor: args.definidoPor,
          observacao: args.observacao ?? null,
        },
      });
    }
  });

  const viatura = await vigenteDe(args.usuarioId);
  const aplicacao = await aplicarNaJornadaAberta(args);
  return { viatura, ...aplicacao };
}

/** Pura: decide se a troca do carro fixo mexe no turno de agora. */
export function decidirAplicacao(temJornadaAberta: boolean, temEscalaHoje: boolean): ResultadoDefinir["motivoNaoAplicado"] {
  if (!temJornadaAberta) return "sem_jornada";
  if (temEscalaHoje) return "escala_hoje";
  return null;
}

async function aplicarNaJornadaAberta(args: DefinirArgs): Promise<Omit<ResultadoDefinir, "viatura">> {
  const jornada = await prisma.jornadaTecnico.findFirst({
    where: { usuarioId: args.usuarioId, fimEm: null },
    select: { id: true },
  });
  const { diaDe } = await import("./escalaService.js");
  const escalaHoje = await prisma.escalaJornada.findUnique({
    where: { usuarioId_dia: { usuarioId: args.usuarioId, dia: diaDe(new Date()) } },
    select: { id: true },
  });
  const motivo = decidirAplicacao(!!jornada, !!escalaHoje);
  if (motivo) return { aplicadoAgora: false, motivoNaoAplicado: motivo };

  await prisma.$transaction(async (tx) => {
    if (args.veiculoId) {
      await declararDentroDaTransacao(tx, {
        usuarioId: args.usuarioId,
        veiculoId: args.veiculoId,
        papel: args.papel,
        origem: "ajuste",
        declaradoPorId: args.definidoPor,
        jornadaId: jornada!.id,
      });
    } else {
      await encerrarDentroDaTransacao(tx, args.usuarioId, "ajuste");
    }
  });
  return { aplicadoAgora: true, motivoNaoAplicado: null };
}
