import { Prisma } from "@prisma/client";
import {
  competenciaDe,
  consumoPorAbastecimento,
  deCentavos,
  normalizarPlaca,
  paraCentavos,
  placaValida,
  sinalDoMovimento,
  type MovimentoCartaoTipo,
  type TipoCombustivel,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { dataCivil, exigirValor, isoDeData, moeda } from "./lancamentoService.js";

/**
 * FROTA — veiculos, abastecimentos e cartao-combustivel.
 *
 * Duas divergencias deliberadas do ERP de origem, as duas sobre o mesmo vicio:
 * guardar o que da pra calcular.
 *
 * 1. O vinculo do abastecimento com o financeiro e a FK `lancamentoId`, nao um
 *    booleano `synced_to_finance` ao lado de `finance_transaction_id`. Dois
 *    fatos sobre a mesma coisa, e o booleano pode dizer "sim" com a FK vazia.
 *
 * 2. O saldo do cartao e a SOMA dos movimentos. A origem guarda
 *    `current_balance` no cartao E `new_balance` em cada movimento — tres
 *    versoes do mesmo numero, e basta um movimento removido ou inserido fora de
 *    ordem pras tres discordarem.
 */

// ---------------------------------------------------------------------------
// Veiculos
// ---------------------------------------------------------------------------

export async function listarVeiculos() {
  const rows = await prisma.veiculo.findMany({
    orderBy: [{ ativo: "desc" }, { placa: "asc" }],
    select: {
      id: true,
      placa: true,
      modelo: true,
      ano: true,
      ativo: true,
      _count: { select: { abastecimentos: true } },
      // O ultimo odometro vem do proprio abastecimento — nao ha coluna
      // espelhando isso no veiculo.
      abastecimentos: { orderBy: { km: "desc" }, take: 1, select: { km: true } },
    },
  });
  return rows.map((v) => ({
    id: v.id,
    placa: v.placa,
    modelo: v.modelo,
    ano: v.ano,
    ativo: v.ativo,
    totalAbastecimentos: v._count.abastecimentos,
    ultimoKm: v.abastecimentos[0]?.km ?? null,
  }));
}

export async function criarVeiculo(args: { placa: string; modelo: string; ano?: number | null }) {
  /*
   * A normalizacao mora em @isphub/shared e e a UNICA dona da regra. Antes,
   * daqui saia `toUpperCase()` + tira espaco, mas NAO tirava hifen — entao
   * "ABC-1234" e "ABC1234" viravam dois veiculos, e o rastreador ficava
   * vinculado a so um deles. A migracao 20260808030000 normalizou o que ja
   * existia; isto impede que volte a acontecer.
   */
  const placa = normalizarPlaca(args.placa);
  if (!placaValida(placa)) {
    throw new HttpError(400, "Placa invalida — use AAA1234 ou ABC1D23 (Mercosul)");
  }
  const existente = await prisma.veiculo.findUnique({ where: { placa } });
  if (existente) throw new HttpError(409, "Ja existe um veiculo com essa placa");
  return prisma.veiculo.create({
    data: { placa, modelo: args.modelo.trim(), ano: args.ano ?? null },
    select: { id: true },
  });
}

export async function alternarVeiculo(id: string, ativo: boolean) {
  await prisma.veiculo.update({ where: { id }, data: { ativo } });
}

// ---------------------------------------------------------------------------
// Abastecimentos
// ---------------------------------------------------------------------------

export async function listarAbastecimentos(veiculoId?: string) {
  const rows = await prisma.abastecimento.findMany({
    where: veiculoId ? { veiculoId } : undefined,
    orderBy: [{ data: "desc" }, { km: "desc" }],
    select: {
      id: true,
      veiculoId: true,
      data: true,
      km: true,
      litros: true,
      valorTotal: true,
      combustivel: true,
      posto: true,
      tanqueCheio: true,
      lancamentoId: true,
      veiculo: { select: { placa: true } },
      responsavel: { select: { nome: true } },
    },
  });

  /*
   * O consumo e calculado POR VEICULO. Misturar odometros de veiculos
   * diferentes na mesma serie produziria um km/l sem sentido — e plausivel o
   * bastante pra ninguem desconfiar.
   */
  const consumoPorId = new Map<string, number | null>();
  const porVeiculo = new Map<string, typeof rows>();
  for (const r of rows) {
    const lista = porVeiculo.get(r.veiculoId) ?? [];
    lista.push(r);
    porVeiculo.set(r.veiculoId, lista);
  }
  for (const lista of porVeiculo.values()) {
    const consumos = consumoPorAbastecimento(
      lista.map((a) => ({ km: a.km, litros: a.litros.toString(), tanqueCheio: a.tanqueCheio })),
    );
    lista.forEach((a, i) => consumoPorId.set(a.id, consumos[i]));
  }

  return rows.map((r) => ({
    id: r.id,
    veiculoId: r.veiculoId,
    veiculoPlaca: r.veiculo.placa,
    data: isoDeData(r.data)!,
    km: r.km,
    litros: r.litros.toString(),
    valorTotal: moeda(r.valorTotal)!,
    combustivel: r.combustivel,
    posto: r.posto,
    tanqueCheio: r.tanqueCheio,
    consumo: consumoPorId.get(r.id) ?? null,
    lancamentoId: r.lancamentoId,
    responsavelNome: r.responsavel?.nome ?? null,
  }));
}

export interface AbastecimentoArgs {
  veiculoId: string;
  data: string;
  km: number;
  litros: string;
  valorTotal: string;
  combustivel: TipoCombustivel;
  posto?: string | null;
  tanqueCheio?: boolean;
  categoriaId?: string | null;
  autorId: string;
}

/**
 * Registra o abastecimento E a despesa, na MESMA transacao.
 *
 * Um abastecimento sem lancamento e gasto que nao aparece no DRE; um lancamento
 * sem abastecimento e despesa sem origem. Os dois ou nenhum.
 */
export async function registrarAbastecimento(args: AbastecimentoArgs) {
  const valorTotal = exigirValor(args.valorTotal, "valorTotal");
  dataCivil(args.data, "data");
  if (!Number.isInteger(args.km) || args.km < 0) throw new HttpError(400, "Odometro invalido");

  const litros = Number(args.litros.replace(",", "."));
  if (!Number.isFinite(litros) || litros <= 0) throw new HttpError(400, "Litros invalido");

  const veiculo = await prisma.veiculo.findUnique({
    where: { id: args.veiculoId },
    select: { id: true, placa: true },
  });
  if (!veiculo) throw new HttpError(404, "Veiculo nao encontrado");

  // Odometro nao anda pra tras. Recusar aqui e melhor do que aceitar e depois
  // exibir "—" pra sempre no consumo sem ninguem entender por que.
  const anterior = await prisma.abastecimento.findFirst({
    where: { veiculoId: args.veiculoId },
    orderBy: { km: "desc" },
    select: { km: true },
  });
  if (anterior && args.km < anterior.km) {
    throw new HttpError(400, `Odometro menor que o ultimo registrado (${anterior.km} km)`);
  }

  return prisma.$transaction(async (tx) => {
    const lancamento = await tx.lancamento.create({
      data: {
        tipo: "despesa",
        descricao: `Combustivel ${veiculo.placa}`,
        valor: new Prisma.Decimal(valorTotal),
        vencimento: dataCivil(args.data),
        competencia: dataCivil(competenciaDe(args.data)),
        categoriaId: args.categoriaId ?? null,
        observacao: args.posto?.trim() || null,
        criadoPorId: args.autorId,
      },
      select: { id: true },
    });

    await tx.lancamentoEvento.create({
      data: {
        lancamentoId: lancamento.id,
        tipo: "criado",
        autorId: args.autorId,
        detalhe: { origem: "abastecimento", veiculo: veiculo.placa, km: args.km },
      },
    });

    try {
      return await tx.abastecimento.create({
        data: {
          veiculoId: args.veiculoId,
          data: dataCivil(args.data),
          km: args.km,
          litros: new Prisma.Decimal(litros.toFixed(3)),
          valorTotal: new Prisma.Decimal(valorTotal),
          combustivel: args.combustivel,
          posto: args.posto?.trim() || null,
          tanqueCheio: args.tanqueCheio ?? true,
          lancamentoId: lancamento.id,
          responsavelId: args.autorId,
        },
        select: { id: true },
      });
    } catch (err) {
      // A unicidade (veiculo, km) e o que impede o mesmo abastecimento entrar
      // duas vezes por duplo clique.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, `Ja existe abastecimento deste veiculo em ${args.km} km`);
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Cartao-combustivel
// ---------------------------------------------------------------------------

export async function listarCartoes() {
  const rows = await prisma.cartaoCombustivel.findMany({
    orderBy: [{ ativo: "desc" }, { numero: "asc" }],
    select: {
      id: true,
      numero: true,
      titularId: true,
      ativo: true,
      titular: { select: { nome: true } },
      movimentos: { select: { tipo: true, valor: true } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    numero: c.numero,
    titularId: c.titularId,
    titularNome: c.titular?.nome ?? null,
    ativo: c.ativo,
    // SOMA dos movimentos, em centavos inteiros. Nao ha coluna de saldo.
    saldo: deCentavos(
      c.movimentos.reduce((acc, m) => acc + sinalDoMovimento(m.tipo) * paraCentavos(m.valor.toFixed(2)), 0),
    ),
    totalMovimentos: c.movimentos.length,
  }));
}

export async function criarCartao(args: { numero: string; titularId?: string | null }) {
  const numero = args.numero.trim();
  const existente = await prisma.cartaoCombustivel.findUnique({ where: { numero } });
  if (existente) throw new HttpError(409, "Ja existe um cartao com esse numero");
  return prisma.cartaoCombustivel.create({
    data: { numero, titularId: args.titularId ?? null },
    select: { id: true },
  });
}

export async function movimentarCartao(args: {
  cartaoId: string;
  tipo: MovimentoCartaoTipo;
  valor: string;
  data: string;
  descricao?: string | null;
}) {
  const valor = exigirValor(args.valor);
  dataCivil(args.data, "data");
  const cartao = await prisma.cartaoCombustivel.findUnique({
    where: { id: args.cartaoId },
    select: { id: true },
  });
  if (!cartao) throw new HttpError(404, "Cartao nao encontrado");

  return prisma.movimentoCartao.create({
    data: {
      cartaoId: args.cartaoId,
      tipo: args.tipo,
      // Sempre positivo: o sinal vem do tipo. Um "deposito" de -500 zeraria o
      // saldo sem aparecer como consumo em lugar nenhum.
      valor: new Prisma.Decimal(valor),
      data: dataCivil(args.data),
      descricao: args.descricao?.trim() || null,
    },
    select: { id: true },
  });
}

export async function movimentosDoCartao(cartaoId: string) {
  const rows = await prisma.movimentoCartao.findMany({
    where: { cartaoId },
    orderBy: [{ data: "desc" }, { criadoEm: "desc" }],
    select: { id: true, tipo: true, valor: true, data: true, descricao: true },
  });
  return rows.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    valor: moeda(m.valor)!,
    data: isoDeData(m.data)!,
    descricao: m.descricao,
  }));
}
