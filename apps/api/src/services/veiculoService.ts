import {
  formatarPlaca,
  normalizarPlaca,
  odometroMonotonico,
  placaValida,
  type StatusVeiculo,
  type TipoVeiculo,
} from "@isphub/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * Cadastro de veiculo do modulo Frota.
 *
 * Separado de `frotaService` de proposito: aquele e o angulo FINANCEIRO
 * (abastecimento, cartao, consumo) e vive sob /financeiro, so ADMIN. Este e o
 * angulo OPERACIONAL, de ADMIN e GESTOR. Mesma tabela, duas leituras — o que
 * nao pode e cada um ter a sua regra de placa ou de odometro, entao as duas
 * saem de `@isphub/shared`.
 */

export interface VeiculoPublicFrota {
  id: string;
  placa: string;
  /** Com hifen no formato antigo — so exibicao. */
  placaFormatada: string;
  modelo: string;
  marca: string | null;
  ano: number | null;
  cor: string | null;
  tipo: TipoVeiculo;
  status: StatusVeiculo;
  odometroKm: number | null;
  renavam: string | null;
  chassi: string | null;
  provedorId: string | null;
  provedorNome: string | null;
  criadoEm: string;
}

const SELECT = {
  id: true,
  placa: true,
  modelo: true,
  marca: true,
  ano: true,
  cor: true,
  tipo: true,
  status: true,
  odometroKm: true,
  renavam: true,
  chassi: true,
  provedorId: true,
  provedor: { select: { nome: true } },
  criadoEm: true,
} satisfies Prisma.VeiculoSelect;

type Linha = Prisma.VeiculoGetPayload<{ select: typeof SELECT }>;

function serializar(v: Linha): VeiculoPublicFrota {
  return {
    id: v.id,
    placa: v.placa,
    placaFormatada: formatarPlaca(v.placa),
    modelo: v.modelo,
    marca: v.marca,
    ano: v.ano,
    cor: v.cor,
    tipo: v.tipo,
    status: v.status,
    odometroKm: v.odometroKm,
    renavam: v.renavam,
    chassi: v.chassi,
    provedorId: v.provedorId,
    provedorNome: v.provedor?.nome ?? null,
    criadoEm: v.criadoEm.toISOString(),
  };
}

/**
 * Placa canonica, ou 400.
 *
 * A validacao acontece AQUI e nao no zod da rota porque a normalizacao vem
 * antes: "abc-1234" e uma entrada perfeitamente valida do usuario, e so depois
 * de limpa da pra dizer se e uma placa.
 */
function exigirPlaca(bruta: string): string {
  const placa = normalizarPlaca(bruta);
  if (!placaValida(placa)) {
    throw new HttpError(400, "Placa invalida — use o formato AAA1234 ou ABC1D23 (Mercosul)");
  }
  return placa;
}

export async function listar(where: Record<string, unknown>): Promise<VeiculoPublicFrota[]> {
  const linhas = await prisma.veiculo.findMany({
    where,
    // Inativo pro fim: o operacional trabalha com o que roda hoje.
    orderBy: [{ status: "asc" }, { placa: "asc" }],
    select: SELECT,
  });
  return linhas.map(serializar);
}

export async function obter(id: string): Promise<Linha | null> {
  return prisma.veiculo.findUnique({ where: { id }, select: SELECT });
}

export interface CriarArgs {
  placa: string;
  modelo: string;
  marca?: string | null;
  ano?: number | null;
  cor?: string | null;
  tipo?: TipoVeiculo;
  provedorId?: string | null;
  odometroKm?: number | null;
  renavam?: string | null;
  chassi?: string | null;
}

export async function criar(args: CriarArgs): Promise<VeiculoPublicFrota> {
  const placa = exigirPlaca(args.placa);

  /*
   * Checagem amigavel + P2002 como rede. A checagem cobre o caso normal (a
   * mensagem fica boa); a corrida entre dois cadastros simultaneos so o indice
   * unico resolve, e sem o catch ela vazaria como erro 500.
   */
  try {
    const criado = await prisma.veiculo.create({
      data: {
        placa,
        modelo: args.modelo.trim(),
        marca: args.marca?.trim() || null,
        ano: args.ano ?? null,
        cor: args.cor?.trim() || null,
        tipo: args.tipo ?? "carro",
        provedorId: args.provedorId ?? null,
        odometroKm: odometroMonotonico(null, args.odometroKm),
        renavam: args.renavam?.replace(/\D/g, "") || null,
        chassi: args.chassi?.trim().toUpperCase() || null,
      },
      select: SELECT,
    });
    return serializar(criado);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new HttpError(409, `Ja existe um veiculo com a placa ${formatarPlaca(placa)}`);
    }
    throw e;
  }
}

export interface EditarArgs extends Partial<Omit<CriarArgs, "placa">> {
  status?: StatusVeiculo;
}

export async function editar(id: string, args: EditarArgs): Promise<VeiculoPublicFrota> {
  const atual = await prisma.veiculo.findUnique({ where: { id }, select: { odometroKm: true } });
  if (!atual) throw new HttpError(404, "Veiculo nao encontrado");

  const data: Prisma.VeiculoUpdateInput = {};
  if (args.modelo !== undefined) data.modelo = args.modelo.trim();
  if (args.marca !== undefined) data.marca = args.marca?.trim() || null;
  if (args.ano !== undefined) data.ano = args.ano ?? null;
  if (args.cor !== undefined) data.cor = args.cor?.trim() || null;
  if (args.tipo !== undefined) data.tipo = args.tipo;
  if (args.renavam !== undefined) data.renavam = args.renavam?.replace(/\D/g, "") || null;
  if (args.chassi !== undefined) data.chassi = args.chassi?.trim().toUpperCase() || null;
  if (args.provedorId !== undefined) {
    data.provedor = args.provedorId ? { connect: { id: args.provedorId } } : { disconnect: true };
  }

  /*
   * O odometro so sobe. Um digito a menos ("15000" virando "1500") zeraria o
   * historico e estragaria todo calculo de consumo depois dele — regra que o
   * ERP de referencia repetia em quatro arquivos e aqui e uma so.
   */
  if (args.odometroKm !== undefined) {
    data.odometroKm = odometroMonotonico(atual.odometroKm, args.odometroKm);
  }

  /*
   * `ativo` e `status` andam JUNTOS. `ativo` continua existindo porque
   * /financeiro/frota le e escreve nele; deixar os dois divergirem criaria um
   * veiculo "inativo" que ainda aparece na tela de abastecimento.
   */
  if (args.status !== undefined) {
    data.status = args.status;
    data.ativo = args.status !== "inativo";
  }

  const atualizado = await prisma.veiculo.update({ where: { id }, data, select: SELECT });
  return serializar(atualizado);
}

export { serializar as serializarVeiculo };
