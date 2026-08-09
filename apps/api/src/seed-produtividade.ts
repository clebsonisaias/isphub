import { OsStatus, Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma.js";

/**
 * SEED DA PRODUTIVIDADE — trinta dias de equipe em campo.
 *
 * Existe pela mesma razao do `seed-bi.ts`, e com um risco a mais: este painel
 * mostra o NOME de pessoas. Um bug numa pontuacao nao produz um grafico
 * estranho — produz uma conversa injusta com alguem. Ele precisa ser lido e
 * discutido antes de ter gente de verdade dentro.
 *
 * O que ele planta de proposito:
 *
 * 1. **Tres tipos de servico com duracoes MUITO diferentes** (instalacao ~90
 *    min, reparo ~45, retirada ~20). E o caso que a pontuacao existe pra
 *    resolver: num ranking por contagem, quem so faz retirada ganha sempre.
 * 2. **Um tecnico que faz o servico dificil e outro que faz o facil.** Se o
 *    primeiro aparecer atras por contagem e na frente por pontos, a regra
 *    funciona; se nao, ela nao serve.
 * 3. **Um tipo com POUCAS amostras**, pra tela ter de dizer "sem peso medido"
 *    em vez de inventar um.
 * 4. **Os tres modos de fechar**: o proprio tecnico pelo app, o gestor pelo
 *    painel, e o SGP por fora (sem autor nenhum).
 * 5. **Jornada e viatura**: alguem que fecha fora do expediente registrado, e
 *    alguem que roda com colega no carro.
 *
 * IDEMPOTENTE: reexecutar apaga o que este seed criou (pelo prefixo do
 * `sgpOsId`) e refaz. Nao toca em OS de verdade.
 */

const PREFIXO = "PROD-";
const DIAS = 30;
const AGORA = new Date();

let semente = 20260810;
function aleatorio(): number {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}
function entre(min: number, max: number): number {
  return min + aleatorio() * (max - min);
}

interface TipoPlantado {
  codigo: string;
  descricao: string;
  /** Quanto tempo o servico leva, em minutos — o que vira o PESO. */
  duracaoMin: number;
  /** Quantas por dia util a equipe faz deste tipo. */
  porDia: number;
}

const TIPOS: TipoPlantado[] = [
  { codigo: `${PREFIXO}INST`, descricao: "Instalação", duracaoMin: 90, porDia: 2 },
  { codigo: `${PREFIXO}REP`, descricao: "Reparo", duracaoMin: 45, porDia: 3 },
  { codigo: `${PREFIXO}RET`, descricao: "Retirada", duracaoMin: 20, porDia: 4 },
  /*
   * Raro DE PROPOSITO: com menos de cinco amostras medidas no periodo, o peso
   * nao pode ser calculado, e a tela tem de dizer isso em vez de fingir 1,0.
   */
  { codigo: `${PREFIXO}VIST`, descricao: "Vistoria técnica", duracaoMin: 60, porDia: 0.1 },
];

interface TecnicoPlantado {
  email: string;
  nome: string;
  /** Que tipos ele pega — e o que separa "fez muito" de "fez o dificil". */
  tipos: string[];
  /** Fecha as proprias OS pelo app, ou o gestor fecha por ele? */
  fechaSozinho: boolean;
  /** Registra jornada? Quem nao registra cai em "sem jornada", nao em "fora". */
  registraJornada: boolean;
  /** Anda com colega no carro. */
  comColega: boolean;
}

const TECNICOS: TecnicoPlantado[] = [
  // Faz o servico DIFICIL: menos OS, mais pontos. E o teste da regra inteira.
  { email: "prod-joao@isphub.test", nome: "João Instalador", tipos: [`${PREFIXO}INST`], fechaSozinho: true, registraJornada: true, comColega: true },
  // Faz o servico RAPIDO: muitas OS, menos pontos.
  { email: "prod-maria@isphub.test", nome: "Maria Retiradas", tipos: [`${PREFIXO}RET`], fechaSozinho: true, registraJornada: true, comColega: false },
  { email: "prod-carlos@isphub.test", nome: "Carlos Misto", tipos: [`${PREFIXO}REP`, `${PREFIXO}INST`, `${PREFIXO}VIST`], fechaSozinho: true, registraJornada: true, comColega: false },
  // Nao registra jornada e nao fecha pelo app — o gestor fecha por ele. E o
  // perfil que a tela precisa distinguir de "nao trabalhou".
  { email: "prod-pedro@isphub.test", nome: "Pedro Sem Registro", tipos: [`${PREFIXO}REP`, `${PREFIXO}RET`], fechaSozinho: false, registraJornada: false, comColega: false },
];

function diaUtil(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

async function limpar(): Promise<void> {
  const os = await prisma.ordemServico.findMany({
    where: { sgpOsId: { startsWith: PREFIXO } },
    select: { id: true },
  });
  const ids = os.map((o) => o.id);
  if (ids.length > 0) {
    await prisma.osEvento.deleteMany({ where: { ordemServicoId: { in: ids } } });
    await prisma.atribuicao.deleteMany({ where: { ordemServicoId: { in: ids } } });
    await prisma.notificacao.deleteMany({ where: { ordemServicoId: { in: ids } } });
    await prisma.ocupacaoVeiculo.updateMany({
      where: { ordemServicoId: { in: ids } },
      data: { ordemServicoId: null },
    });
    await prisma.ordemServico.deleteMany({ where: { id: { in: ids } } });
  }
  const usuarios = await prisma.usuario.findMany({
    where: { email: { in: TECNICOS.map((t) => t.email) } },
    select: { id: true },
  });
  const uids = usuarios.map((u) => u.id);
  if (uids.length > 0) {
    await prisma.ocupacaoVeiculo.deleteMany({ where: { usuarioId: { in: uids } } });
    await prisma.jornadaTecnico.deleteMany({ where: { usuarioId: { in: uids } } });
  }
  await prisma.tipoOs.deleteMany({ where: { sgpCodigo: { startsWith: PREFIXO } } });
  console.log(`[seed-prod] limpou ${ids.length} OS e ${uids.length} tecnico(s) da rodada anterior`);
}

async function main(): Promise<void> {
  await limpar();

  const provedor = await prisma.provedor.findFirst({ select: { id: true } });
  if (!provedor) throw new Error("Nenhum provedor cadastrado — rode o seed principal antes.");

  const gestor = await prisma.usuario.findFirst({
    where: { role: { in: ["admin", "gestor"] } },
    select: { id: true },
  });
  if (!gestor) throw new Error("Nenhum admin/gestor cadastrado — rode o seed principal antes.");

  /*
   * UM CARRO POR TECNICO, e nao um carro para todos. Com a frota inteira no
   * mesmo veiculo, todo mundo aparecia "com colega" — o service estava certo
   * (quatro pessoas no mesmo carro SAO colegas), o seed e que descrevia uma
   * operacao impossivel. Sem isto o ramo "sozinho" nunca era exercitado.
   */
  const veiculos = await prisma.veiculo.findMany({
    where: { ativo: true },
    select: { id: true },
    take: TECNICOS.length,
    orderBy: { placa: "asc" },
  });

  const tipoPorCodigo = new Map<string, string>();
  for (const t of TIPOS) {
    const criado = await prisma.tipoOs.create({
      data: { provedorId: provedor.id, sgpCodigo: t.codigo, descricao: t.descricao, visivel: true },
    });
    tipoPorCodigo.set(t.codigo, criado.id);
  }

  const tecnicoPorEmail = new Map<string, string>();
  for (const t of TECNICOS) {
    const u = await prisma.usuario.upsert({
      where: { email: t.email },
      update: { nome: t.nome, ativo: true },
      create: {
        nome: t.nome,
        email: t.email,
        // Hash de uma senha que ninguem usa: estes usuarios existem pra aparecer
        // no ranking, nao pra entrar. Nao ha login de seed aqui.
        senhaHash: "$2b$10$K7L1OJ0TfQeF0eQeF0eQeOxJ0TfQeF0eQeF0eQeF0eQeF0eQeF0eQ",
        role: "tecnico",
        ativo: true,
      },
      select: { id: true },
    });
    tecnicoPorEmail.set(t.email, u.id);
  }

  let osCriadas = 0;
  let eventos = 0;

  for (let d = DIAS; d >= 1; d -= 1) {
    const dia = new Date(AGORA.getTime() - d * 86400_000);
    if (!diaUtil(dia)) continue;

    for (const [indice, tec] of TECNICOS.entries()) {
      const tecnicoId = tecnicoPorEmail.get(tec.email)!;
      const veiculo = veiculos[indice] ?? null;

      // --- a jornada do dia -------------------------------------------------
      const inicioJornada = new Date(
        Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 11, 0),
      ); // 08:00 em Natal
      const fimJornada = new Date(inicioJornada.getTime() + 9 * 3600_000); // 17:00 BR
      let jornadaId: string | null = null;
      if (tec.registraJornada) {
        const j = await prisma.jornadaTecnico.create({
          data: { usuarioId: tecnicoId, inicioEm: inicioJornada, fimEm: fimJornada },
          select: { id: true },
        });
        jornadaId = j.id;

        if (veiculo) {
          await prisma.ocupacaoVeiculo.create({
            data: {
              veiculoId: veiculo.id,
              usuarioId: tecnicoId,
              inicioEm: inicioJornada,
              fimEm: fimJornada,
              papel: "motorista",
              origem: "jornada",
              declaradoPorId: tecnicoId,
              jornadaId,
            },
          });
        }
      }

      // --- as OS do dia -----------------------------------------------------
      for (const codigo of tec.tipos) {
        const tipo = TIPOS.find((t) => t.codigo === codigo)!;
        const quantas = tipo.porDia < 1 ? (aleatorio() < tipo.porDia ? 1 : 0) : Math.round(tipo.porDia * entre(0.6, 1.4));

        for (let i = 0; i < quantas; i += 1) {
          // Sai as 8h + i*2h; a de indice alto pode passar do fim da jornada —
          // e e assim que o caso "fechou fora do expediente" nasce sozinho.
          const partida = new Date(inicioJornada.getTime() + i * 2 * 3600_000 + entre(0, 30) * 60_000);
          const fechamento = new Date(partida.getTime() + tipo.duracaoMin * entre(0.8, 1.25) * 60_000);

          const os = await prisma.ordemServico.create({
            data: {
              provedorId: provedor.id,
              sgpOsId: `${PREFIXO}${osCriadas + 1}`,
              tipoOsId: tipoPorCodigo.get(codigo)!,
              status: OsStatus.concluida,
              tecnicoId,
              clienteNome: `Cliente ${osCriadas + 1}`,
              dataCadastro: partida,
            },
            select: { id: true },
          });
          osCriadas += 1;

          /*
           * A partida e o fechamento sao gravados no MESMO formato que
           * `writebackService` grava — inclusive `statusDe`/`statusPara`. Um
           * seed com forma propria testaria o seed, e nao o codigo.
           */
          const linhas: Prisma.OsEventoCreateManyInput[] = [
            {
              ordemServicoId: os.id,
              tipo: "status",
              autorId: tecnicoId,
              descricao: "Marcado como a caminho",
              statusDe: OsStatus.aberta,
              statusPara: OsStatus.em_deslocamento,
              criadoEm: partida,
            },
            {
              ordemServicoId: os.id,
              tipo: "status",
              // Os TRES modos de fechar. `null` = o SGP encerrou por fora, e a
              // ausencia de autor E o dado: ninguem daqui registrou nada.
              autorId: tec.fechaSozinho ? tecnicoId : aleatorio() < 0.8 ? gestor.id : null,
              descricao: "Status alterado: A caminho → Concluida",
              statusDe: OsStatus.em_deslocamento,
              statusPara: OsStatus.concluida,
              criadoEm: fechamento,
            },
          ];
          await prisma.osEvento.createMany({ data: linhas });
          eventos += linhas.length;
        }
      }

      // --- o colega no carro ------------------------------------------------
      if (tec.comColega && veiculo && jornadaId) {
        /*
         * O colega tem de ser quem NAO abre viatura propria. O banco tem uma
         * exclusion constraint que impede a mesma pessoa em dois intervalos
         * sobrepostos — e e ela que torna "quem estava no carro" uma resposta
         * unica em vez de um palpite. Pondo aqui quem ja e motorista do dia, o
         * INSERT e recusado, e com razao.
         */
        const colega = TECNICOS.find((t) => t.email !== tec.email && !t.registraJornada);
        if (colega) {
          await prisma.ocupacaoVeiculo.create({
            data: {
              veiculoId: veiculo.id,
              usuarioId: tecnicoPorEmail.get(colega.email)!,
              inicioEm: inicioJornada,
              fimEm: fimJornada,
              papel: "passageiro",
              origem: "declaracao",
              declaradoPorId: tecnicoId,
            },
          });
        }
      }
    }
  }

  console.log(`[seed-prod] pronto: ${osCriadas} OS concluidas, ${eventos} eventos, ${TECNICOS.length} tecnicos.`);
  console.log("[seed-prod] casos plantados: servico dificil x rapido (a pontuacao tem de inverter");
  console.log("[seed-prod]                  o ranking da contagem), tipo sem amostra suficiente,");
  console.log("[seed-prod]                  os tres modos de fechar, e quem nao registra jornada.");
}

main()
  .catch((e) => {
    console.error("[seed-prod] falhou:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
