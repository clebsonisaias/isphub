import { Prisma } from "@prisma/client";
import { chaveDiaBrasileiro } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";

/**
 * SEED DO BI DA FROTA — tres meses de operacao plausivel.
 *
 * Nao e conveniencia: producao esta praticamente vazia (um veiculo, nenhuma
 * viagem), e um BI que so pode ser conferido depois que o dado existir e um BI
 * que ninguem confere. Este script fabrica o substrato para que cada bloco da
 * tela possa ser lido, discutido e corrigido ANTES de a frota real encher.
 *
 * O que ele faz de proposito, e que um gerador ingenuo nao faria:
 *
 * 1. **Planta os casos que a auditoria existe para achar.** Um veiculo com
 *    divergencia odometro/GPS, um com rastreador cego metade do periodo, um que
 *    abastece sem rodar. Sem eles, o bloco "o que nao bate" fica vazio e ninguem
 *    descobre que ele nao funciona.
 * 2. **Deixa veiculos SEM rastreador.** E a situacao real da frota, e a tela
 *    precisa provar que diz "sem rastreador" em vez de "0 km".
 * 3. **Reusa o codigo de producao.** As viagens sao gravadas pelo mesmo formato
 *    que `frotaEventoService` grava; nada de linha inventada com forma
 *    diferente da que a coleta produz.
 *
 * IDEMPOTENTE: reexecutar apaga o que este seed criou (pelo prefixo de placa) e
 * refaz. Nao toca em nada fora do prefixo — a HFX-3652 real fica intacta.
 */

/** Todo veiculo deste seed comeca assim. E o que torna a limpeza segura. */
const PREFIXO = "BI";

const DIAS = 90;
const AGORA = new Date();

/** Aleatoriedade REPETIVEL: o mesmo seed produz o mesmo banco, sempre. */
let semente = 20260809;
function aleatorio(): number {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}
function entre(min: number, max: number): number {
  return min + aleatorio() * (max - min);
}
function inteiroEntre(min: number, max: number): number {
  return Math.floor(entre(min, max + 1));
}

/** Macaiba/RN — onde a frota real opera. */
const BASE = { lat: -5.8567, lng: -35.3536 };

interface Perfil {
  placa: string;
  modelo: string;
  /** Sem rastreador = a maioria da frota real. */
  comRastreador: boolean;
  /** km/l tipico do carro — o seed gera abastecimento coerente com ele. */
  consumoAlvo: number;
  /** Quantos km o carro roda por dia util. */
  kmPorDia: number;
  /** O caso que este veiculo existe para exercitar. */
  caso: "normal" | "divergencia" | "rastreador_cego" | "abastece_sem_rodar" | "ocioso";
}

const PERFIS: Perfil[] = [
  { placa: "BIA1A11", modelo: "Fiat Uno", comRastreador: true, consumoAlvo: 12.5, kmPorDia: 95, caso: "normal" },
  { placa: "BIB2B22", modelo: "VW Saveiro", comRastreador: true, consumoAlvo: 10.2, kmPorDia: 120, caso: "normal" },
  /*
   * O carro que o bloco de auditoria existe para achar: o odometro anda MUITO
   * mais do que o GPS ve, e nao por falta de cobertura.
   */
  { placa: "BIC3C33", modelo: "Renault Kangoo", comRastreador: true, consumoAlvo: 9.8, kmPorDia: 110, caso: "divergencia" },
  /*
   * O contraexemplo indispensavel: tambem diverge, mas porque o aparelho passou
   * metade do periodo cego. Se a tela acusar este, ela esta errada.
   */
  { placa: "BID4D44", modelo: "Fiat Strada", comRastreador: true, consumoAlvo: 11.0, kmPorDia: 100, caso: "rastreador_cego" },
  { placa: "BIE5E55", modelo: "Chevrolet Onix", comRastreador: false, consumoAlvo: 13.1, kmPorDia: 80, caso: "abastece_sem_rodar" },
  { placa: "BIF6F66", modelo: "Fiat Fiorino", comRastreador: false, consumoAlvo: 10.5, kmPorDia: 0, caso: "ocioso" },
];

const POSTOS = ["Posto Central", "Auto Posto BR", "Posto da Serra", "Shell Macaíba"];

function diaUtil(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

async function limpar(): Promise<void> {
  const antigos = await prisma.veiculo.findMany({
    where: { placa: { startsWith: PREFIXO } },
    select: { id: true },
  });
  if (antigos.length === 0) return;
  const ids = antigos.map((v) => v.id);
  // Ordem importa: `Viagem` e `EventoRastreador` apontam pro veiculo, e
  // `Abastecimento` arrasta o `Lancamento` gemeo.
  await prisma.viagem.deleteMany({ where: { veiculoId: { in: ids } } });
  await prisma.eventoRastreador.deleteMany({ where: { veiculoId: { in: ids } } });
  const abast = await prisma.abastecimento.findMany({
    where: { veiculoId: { in: ids } },
    select: { lancamentoId: true },
  });
  await prisma.abastecimento.deleteMany({ where: { veiculoId: { in: ids } } });
  await prisma.lancamento.deleteMany({
    where: {
      OR: [
        { id: { in: abast.map((a) => a.lancamentoId).filter((x): x is string => !!x) } },
        { veiculoId: { in: ids } },
      ],
    },
  });
  await prisma.posicaoRastreador.deleteMany({ where: { rastreador: { identificadorExterno: { startsWith: PREFIXO } } } });
  await prisma.vinculoRastreador.deleteMany({ where: { veiculoId: { in: ids } } });
  await prisma.rastreador.deleteMany({ where: { identificadorExterno: { startsWith: PREFIXO } } });
  await prisma.ocupacaoVeiculo.deleteMany({ where: { veiculoId: { in: ids } } });
  await prisma.veiculo.deleteMany({ where: { id: { in: ids } } });
  console.log(`[seed-bi] limpou ${ids.length} veiculo(s) do seed anterior`);
}

async function main(): Promise<void> {
  await limpar();

  const categoria = await prisma.categoriaFinanceira.findFirst({
    where: { tipo: "despesa" },
    select: { id: true },
  });

  let viagens = 0;
  let eventos = 0;
  let abastecimentos = 0;

  for (const perfil of PERFIS) {
    const veiculo = await prisma.veiculo.create({
      data: {
        placa: perfil.placa,
        modelo: perfil.modelo,
        tipo: "carro",
        status: "ativo",
        ativo: true,
        // Frota da propria operacao — visivel a ADMIN/GESTOR, invisivel a provedor.
        provedorId: null,
      },
    });

    let rastreadorId: string | null = null;
    if (perfil.comRastreador) {
      const r = await prisma.rastreador.create({
        data: {
          identificadorExterno: `${PREFIXO}-${perfil.placa}`,
          apelido: perfil.modelo,
          ativo: true,
          comunicando: true,
          modeloFornecedor: "CRX",
          intervaloFornecedorSeg: 30,
          temComandoCorte: true,
          ultimaPosicaoEm: AGORA,
        },
      });
      rastreadorId = r.id;
      await prisma.vinculoRastreador.create({
        data: { veiculoId: veiculo.id, rastreadorId: r.id, inicioEm: new Date(AGORA.getTime() - DIAS * 86400_000) },
      });
    }

    // ---- a operacao, dia a dia -------------------------------------------
    let odometro = inteiroEntre(30_000, 90_000);
    let litrosDesdeCheio = 0;
    let kmDesdeCheio = 0;
    const viagensParaCriar: Prisma.ViagemCreateManyInput[] = [];
    const eventosParaCriar: Prisma.EventoRastreadorCreateManyInput[] = [];

    for (let d = DIAS; d >= 1; d -= 1) {
      const dia = new Date(AGORA.getTime() - d * 86400_000);
      if (!diaUtil(dia) || perfil.kmPorDia === 0) continue;

      const kmDoDia = Math.round(perfil.kmPorDia * entre(0.6, 1.4));
      /*
       * O ODOMETRO e sempre a verdade fisica: e o que o carro andou. O GPS e
       * uma MEDIDA dele, e cada caso distorce essa medida de um jeito.
       */
      odometro += kmDoDia;
      kmDesdeCheio += kmDoDia;

      // ---- abastecimento ---------------------------------------------------
      const precisaAbastecer = kmDesdeCheio >= 400 || (perfil.caso === "abastece_sem_rodar" && d % 7 === 0);
      if (precisaAbastecer) {
        const litros = Math.max(5, kmDesdeCheio / perfil.consumoAlvo - litrosDesdeCheio);
        const precoLitro = entre(5.5, 6.4);
        const total = litros * precoLitro;
        const posto = POSTOS[inteiroEntre(0, POSTOS.length - 1)]!;

        const lancamento = await prisma.lancamento.create({
          data: {
            tipo: "despesa",
            status: "pago",
            descricao: `Combustível ${perfil.placa}`,
            valor: new Prisma.Decimal(total.toFixed(2)),
            valorPago: new Prisma.Decimal(total.toFixed(2)),
            competencia: new Date(chaveDiaBrasileiro(dia)),
            vencimento: new Date(chaveDiaBrasileiro(dia)),
            pagoEm: new Date(chaveDiaBrasileiro(dia)),
            categoriaId: categoria?.id ?? null,
            veiculoId: veiculo.id,
          },
        });

        await prisma.abastecimento.create({
          data: {
            veiculoId: veiculo.id,
            data: new Date(chaveDiaBrasileiro(dia)),
            km: odometro,
            litros: new Prisma.Decimal(litros.toFixed(3)),
            valorTotal: new Prisma.Decimal(total.toFixed(2)),
            combustivel: "gasolina",
            posto,
            tanqueCheio: true,
            lancamentoId: lancamento.id,
          },
        });
        abastecimentos += 1;
        kmDesdeCheio = 0;
        litrosDesdeCheio = 0;
      }

      if (!rastreadorId) continue;

      /*
       * O GPS ve MENOS que o odometro por construcao: a reta entre amostras de
       * um minuto corta a curva. 8% e o vies normal desta frota — e por isso
       * que a base de comparacao tem de ser a historia do proprio veiculo, e
       * nao a distancia "real".
       */
      let fatorGps = 1 / 1.08;
      // A divergencia plantada: o odometro anda o dobro do que o GPS enxerga.
      if (perfil.caso === "divergencia" && d < DIAS / 2) fatorGps = 1 / 1.9;

      // O rastreador cego: metade do periodo sem enxergar NADA.
      const cegoHoje = perfil.caso === "rastreador_cego" && d < DIAS / 2;
      if (cegoHoje) {
        // O evento nasce no PRIMEIRO dia cego, nao no ultimo dia enxergando.
        if (d === Math.floor(DIAS / 2) - 1) {
          eventosParaCriar.push({
            rastreadorId,
            veiculoId: veiculo.id,
            tipo: "ficou_offline",
            em: dia,
            detalhe: { desde: dia.toISOString() },
          });
        }
        continue;
      }

      const saidas = inteiroEntre(2, 5);
      for (let s = 0; s < saidas; s += 1) {
        const horaSaida = 7 + s * 2 + entre(0, 1);
        const inicio = new Date(
          Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), Math.floor(horaSaida) + 3, inteiroEntre(0, 59)),
        );
        const duracaoMin = inteiroEntre(20, 70);
        const fim = new Date(inicio.getTime() + duracaoMin * 60_000);
        const metros = Math.round(((kmDoDia / saidas) * 1000) * fatorGps);
        const velMax = entre(45, 105);
        const ocioso = inteiroEntre(0, 900);

        viagensParaCriar.push({
          veiculoId: veiculo.id,
          rastreadorId,
          inicioEm: inicio,
          fimEm: fim,
          latInicio: BASE.lat + entre(-0.02, 0.02),
          lngInicio: BASE.lng + entre(-0.02, 0.02),
          latFim: BASE.lat + entre(-0.05, 0.05),
          lngFim: BASE.lng + entre(-0.05, 0.05),
          ultimoEm: fim,
          ultimaVelocidadeKmh: 0,
          distanciaMetros: metros,
          velocidadeMaxKmh: velMax,
          paradoComMotorLigadoSeg: ocioso,
        });

        if (velMax > 100) {
          eventosParaCriar.push({
            rastreadorId,
            veiculoId: veiculo.id,
            tipo: "excesso_velocidade",
            em: new Date(inicio.getTime() + 5 * 60_000),
            detalhe: { velocidadeKmh: Math.round(velMax), limite: 100 },
          });
        }
        if (ocioso >= 600) {
          eventosParaCriar.push({
            rastreadorId,
            veiculoId: veiculo.id,
            tipo: "parado_com_motor_ligado",
            em: inicio,
            detalhe: { minutos: Math.round(ocioso / 60) },
          });
        }
      }

    }

    if (viagensParaCriar.length > 0) {
      await prisma.viagem.createMany({ data: viagensParaCriar, skipDuplicates: true });
      viagens += viagensParaCriar.length;
    }
    if (eventosParaCriar.length > 0) {
      const r = await prisma.eventoRastreador.createMany({ data: eventosParaCriar, skipDuplicates: true });
      eventos += r.count;
    }

    console.log(
      `[seed-bi] ${perfil.placa} (${perfil.caso})` +
        `${perfil.comRastreador ? "" : " — SEM rastreador"}`,
    );
  }

  /*
   * Uma despesa NAO-combustivel por veiculo, para o BI provar que o custo por
   * km e o custo TOTAL e nao so o do posto. E o que `Lancamento.veiculoId`
   * destrava.
   */
  for (const perfil of PERFIS.slice(0, 3)) {
    const v = await prisma.veiculo.findUnique({ where: { placa: perfil.placa }, select: { id: true } });
    if (!v) continue;
    const quando = new Date(AGORA.getTime() - 30 * 86400_000);
    await prisma.lancamento.create({
      data: {
        tipo: "despesa",
        status: "pago",
        descricao: `Revisão e pneus — ${perfil.placa}`,
        valor: new Prisma.Decimal(entre(800, 2400).toFixed(2)),
        valorPago: new Prisma.Decimal(entre(800, 2400).toFixed(2)),
        competencia: new Date(chaveDiaBrasileiro(quando)),
        vencimento: new Date(chaveDiaBrasileiro(quando)),
        pagoEm: new Date(chaveDiaBrasileiro(quando)),
        categoriaId: categoria?.id ?? null,
        veiculoId: v.id,
      },
    });
  }

  console.log(
    `\n[seed-bi] pronto: ${PERFIS.length} veiculos, ${viagens} viagens, ${eventos} eventos, ${abastecimentos} abastecimentos.`,
  );
  console.log("[seed-bi] casos plantados: divergencia (BIC3C33), rastreador cego (BID4D44),");
  console.log("[seed-bi]                  abastece sem rodar (BIE5E55), ocioso (BIF6F66),");
  console.log("[seed-bi]                  e dois SEM rastreador — a tela tem de dizer isso.");
}

main()
  .catch((e) => {
    console.error("[seed-bi] falhou:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
