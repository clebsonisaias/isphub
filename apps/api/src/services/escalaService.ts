import { PapelOcupacao, type EscalaDoDia } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * A ESCALA do dia — quem vai em qual viatura, com quem.
 *
 * Inverte quem decide: antes o tecnico declarava a viatura ao abrir o turno,
 * agora o supervisor escala e o app so mostra. Quem responde por carro, seguro
 * e rodizio e a supervisao.
 *
 * NAO ha tabela de parceiros: "vai com o Rafael" e o supervisor escalar os
 * dois pro mesmo veiculo no mesmo dia. Um segundo lugar dizendo a mesma coisa
 * poderia discordar de si mesmo (A com B, sem B com A).
 */

/**
 * O dia de uma data, em UTC, como o Postgres guarda um DATE.
 *
 * Normalizar aqui e nao no chamador porque a escala e do DIA: comparar
 * instantes deixaria "hoje as 23h em Sao Paulo" cair no dia seguinte.
 */
export function diaDe(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const primeiro = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** A escala de um tecnico num dia, com os parceiros derivados do veiculo. */
export async function escalaDoTecnico(usuarioId: string, dia: Date): Promise<EscalaDoDia> {
  const d = diaDe(dia);
  const escala = await prisma.escalaJornada.findUnique({
    where: { usuarioId_dia: { usuarioId, dia: d } },
    select: { veiculoId: true, papel: true, veiculo: { select: { placa: true } } },
  });

  if (!escala) {
    return { escalado: false, veiculoId: null, veiculoPlaca: null, papel: "motorista", parceiros: [] };
  }

  const parceiros = escala.veiculoId
    ? (
        await prisma.escalaJornada.findMany({
          where: { dia: d, veiculoId: escala.veiculoId, usuarioId: { not: usuarioId } },
          select: { usuario: { select: { nome: true, nomeExibicao: true } } },
        })
      ).map((e) => primeiro(e.usuario.nomeExibicao || e.usuario.nome))
    : [];

  return {
    escalado: true,
    veiculoId: escala.veiculoId,
    veiculoPlaca: escala.veiculo?.placa ?? null,
    papel: escala.papel,
    parceiros,
  };
}

/** O quadro do dia inteiro — a tela do supervisor. */
export async function escalaDoDia(dia: Date) {
  const d = diaDe(dia);
  const linhas = await prisma.escalaJornada.findMany({
    where: { dia: d },
    orderBy: { usuario: { nome: "asc" } },
    select: {
      id: true,
      papel: true,
      veiculoId: true,
      veiculo: { select: { placa: true, apelido: true } },
      usuario: { select: { id: true, nome: true, nomeExibicao: true } },
    },
  });
  return linhas.map((l) => ({
    id: l.id,
    usuarioId: l.usuario.id,
    nome: l.usuario.nomeExibicao || l.usuario.nome,
    veiculoId: l.veiculoId,
    veiculoPlaca: l.veiculo?.placa ?? null,
    veiculoApelido: l.veiculo?.apelido ?? null,
    papel: l.papel,
  }));
}

/**
 * Escala (ou reescala) um tecnico. Upsert pela chave (usuario, dia): mexer na
 * escala do dia ATUALIZA a linha, nao empilha uma segunda que competiria com a
 * primeira.
 */
export async function escalar(args: {
  usuarioId: string;
  dia: Date;
  veiculoId: string | null;
  papel: PapelOcupacao;
  definidoPor: string;
}) {
  const d = diaDe(args.dia);

  if (args.veiculoId) {
    const v = await prisma.veiculo.findUnique({ where: { id: args.veiculoId }, select: { status: true } });
    if (!v) throw new HttpError(404, "Veiculo nao encontrado");
    // Escalar alguem pra um carro inativo produz uma escala que ninguem pode
    // cumprir, e o tecnico so descobre na hora de sair.
    if (v.status === "inativo") throw new HttpError(409, "Veiculo inativo nao pode ser escalado");
  }

  return prisma.escalaJornada.upsert({
    where: { usuarioId_dia: { usuarioId: args.usuarioId, dia: d } },
    create: { usuarioId: args.usuarioId, dia: d, veiculoId: args.veiculoId, papel: args.papel, definidoPor: args.definidoPor },
    update: { veiculoId: args.veiculoId, papel: args.papel, definidoPor: args.definidoPor },
    select: { id: true },
  });
}

/**
 * Qual viatura vale: a do supervisor, quando ha escala; a do app, quando nao ha.
 *
 * Funcao PURA e separada porque e a regra inteira da inversao, e o unico jeito
 * de testa-la sem arrastar Prisma, ocupacao e transacao junto.
 *
 * O `odometro` continua vindo do APP mesmo com escala: quem le o hodometro e
 * quem esta na frente do painel do carro, e isso o supervisor nao tem como
 * saber de antemao.
 */
export function viaturaEfetiva<T extends { veiculoId?: string | null; papel?: PapelOcupacao; odometro?: number | null }>(
  escala: EscalaDoDia,
  doApp: T,
): { veiculoId: string | null | undefined; papel: PapelOcupacao | undefined; odometro: number | null | undefined } {
  if (!escala.escalado) return { veiculoId: doApp.veiculoId, papel: doApp.papel, odometro: doApp.odometro };
  return { veiculoId: escala.veiculoId, papel: escala.papel, odometro: doApp.odometro };
}

/** Tira o tecnico da escala do dia. */
export async function desescalar(usuarioId: string, dia: Date): Promise<void> {
  await prisma.escalaJornada.deleteMany({ where: { usuarioId, dia: diaDe(dia) } });
}
