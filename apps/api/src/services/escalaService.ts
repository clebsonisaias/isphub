import { PapelOcupacao, type EscalaDoDia, type TurnoAgenda } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { manutencoesVencidas } from "./manutencaoService.js";

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
    select: { veiculoId: true, papel: true, turnos: true, veiculo: { select: { placa: true } } },
  });

  if (!escala) return escalaPelaViaturaFixa(usuarioId);

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
    turnos: escala.turnos,
    veiculoId: escala.veiculoId,
    veiculoPlaca: escala.veiculo?.placa ?? null,
    papel: escala.papel,
    parceiros,
    fonte: "escala",
  };
}

const SEM_ESCALA: EscalaDoDia = { escalado: false, turnos: [], veiculoId: null, veiculoPlaca: null, papel: "motorista", parceiros: [] };

/**
 * Sem escala no dia, vale o CARRO FIXO que o gestor definiu. E o padrao; a
 * escala e a excecao. Sem nenhum dos dois, o comportamento antigo segue.
 *
 * Carro fixo parado (manutencao/inativo) nao conta: escalar nele produziria um
 * turno sem carro na hora de sair. O tecnico sai sem viatura e o gestor escala
 * outro carro pro dia.
 */
async function escalaPelaViaturaFixa(usuarioId: string): Promise<EscalaDoDia> {
  const fixa = await prisma.viaturaFixa.findFirst({
    where: { usuarioId, fimEm: null },
    select: { veiculoId: true, papel: true, veiculo: { select: { placa: true, status: true } } },
  });
  if (!fixa) return SEM_ESCALA;
  return escalaDaFixa(fixa, await parceirosFixos(fixa.veiculoId, usuarioId));
}

/** Pura: a viatura fixa traduzida pro formato da escala do dia. */
export function escalaDaFixa(
  fixa: { veiculoId: string; papel: PapelOcupacao; veiculo: { placa: string; status: string } },
  parceiros: string[],
): EscalaDoDia {
  if (fixa.veiculo.status !== "ativo") return SEM_ESCALA;
  return {
    escalado: true,
    turnos: ["manha", "tarde"],
    veiculoId: fixa.veiculoId,
    veiculoPlaca: fixa.veiculo.placa,
    papel: fixa.papel,
    parceiros,
    fonte: "fixa",
  };
}

async function parceirosFixos(veiculoId: string, usuarioId: string): Promise<string[]> {
  const ls = await prisma.viaturaFixa.findMany({
    where: { veiculoId, fimEm: null, usuarioId: { not: usuarioId } },
    select: { usuario: { select: { nome: true, nomeExibicao: true } } },
  });
  return ls.map((l) => primeiro(l.usuario.nomeExibicao || l.usuario.nome));
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
      turnos: true,
      ausenteEm: true,
      motivoAusencia: true,
      veiculoId: true,
      veiculo: { select: { placa: true, apelido: true } },
      usuario: { select: { id: true, nome: true, nomeExibicao: true } },
    },
  });
  // Manutencao vencida AVISA, nao bloqueia: o carro ainda roda; quem decide
  // se sai assim e o supervisor, olhando o aviso na linha.
  const vencidasPorVeiculo = new Map<string, string[]>();
  for (const vid of new Set(linhas.map((l) => l.veiculoId).filter((x): x is string => !!x))) {
    vencidasPorVeiculo.set(vid, await manutencoesVencidas(vid));
  }
  return linhas.map((l) => ({
    id: l.id,
    usuarioId: l.usuario.id,
    nome: l.usuario.nomeExibicao || l.usuario.nome,
    veiculoId: l.veiculoId,
    veiculoPlaca: l.veiculo?.placa ?? null,
    veiculoApelido: l.veiculo?.apelido ?? null,
    papel: l.papel,
    turnos: l.turnos,
    ausenteEm: l.ausenteEm ? l.ausenteEm.toISOString() : null,
    motivoAusencia: l.motivoAusencia,
    manutencaoVencida: l.veiculoId ? (vencidasPorVeiculo.get(l.veiculoId) ?? []) : [],
  }));
}

/**
 * Marca (ou desfaz) a falta de um escalado. E gesto humano: o job de
 * "escalado sem jornada" so avisa — marcar falta sozinho esconderia o atraso
 * de quem chegou 20 min depois.
 */
export async function marcarAusencia(args: { usuarioId: string; dia: Date; ausente: boolean; motivo?: string | null }) {
  const d = diaDe(args.dia);
  const existe = await prisma.escalaJornada.findUnique({ where: { usuarioId_dia: { usuarioId: args.usuarioId, dia: d } }, select: { id: true } });
  if (!existe) throw new HttpError(404, "Esta pessoa nao esta escalada neste dia");
  await prisma.escalaJornada.update({
    where: { id: existe.id },
    data: args.ausente ? { ausenteEm: new Date(), motivoAusencia: args.motivo ?? null } : { ausenteEm: null, motivoAusencia: null },
  });
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
  turnos?: TurnoAgenda[];
  definidoPor: string;
}) {
  const d = diaDe(args.dia);
  const turnos = args.turnos && args.turnos.length > 0 ? args.turnos : (["manha", "tarde"] as TurnoAgenda[]);

  if (args.veiculoId) {
    const v = await prisma.veiculo.findUnique({ where: { id: args.veiculoId }, select: { status: true } });
    if (!v) throw new HttpError(404, "Veiculo nao encontrado");
    // Escalar alguem pra um carro inativo produz uma escala que ninguem pode
    // cumprir, e o tecnico so descobre na hora de sair.
    if (v.status === "inativo") throw new HttpError(409, "Veiculo inativo nao pode ser escalado");
    // Em manutencao tambem: escalar produziria um turno sem carro na hora de sair.
    if (v.status === "manutencao") throw new HttpError(409, "Veiculo em manutencao nao pode ser escalado");
  }

  return prisma.escalaJornada.upsert({
    where: { usuarioId_dia: { usuarioId: args.usuarioId, dia: d } },
    create: { usuarioId: args.usuarioId, dia: d, veiculoId: args.veiculoId, papel: args.papel, turnos, definidoPor: args.definidoPor },
    update: { veiculoId: args.veiculoId, papel: args.papel, turnos, definidoPor: args.definidoPor },
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
