import { Router } from "express";
import { z } from "zod";
import { OsStatus, OS_STATUS_ABERTOS, UserRole, type FilaItem } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { calcularSla } from "../services/slaService.js";
import { escopoOsWhere } from "../services/escopoService.js";
import { prepararFila, wherePendentes } from "../services/filaService.js";
import { resumoMarcacao } from "../lib/eventosAgenda.js";
import { whereEquipeParaUsuario } from "../services/equipeService.js";

export const filaRouter = Router();

filaRouter.use(requireAuth);

/**
 * O que a fila inclui de cada OS — e o que `paraFilaItem` precisa. Exportado
 * porque `GET /ordens-servico/:id` devolve a MESMA forma: a tela de OS e o
 * dialogo da fila sao o mesmo componente, e duas serializacoes divergiriam.
 */
export const INCLUDE_FILA = {
  provedor: true,
  tipoOs: { include: { categoria: true } },
  tecnico: true,
  apoios: { select: { nome: true } },
  // A rota do dia: o supervisor ordena na agenda e o app do tecnico le
  // daqui. Na planilha essa coluna existia e morria na planilha.
  agendamento: {
    select: {
      id: true,
      ordemRota: true,
      turno: true,
      status: true,
      dia: true,
      confirmadoEm: true,
      sgpConfirmadoEm: true,
      // "Quem marcou, quando e se a OS ja estava aberta" — a linha curta do detalhe.
      origem: true,
      marcadoPor: true,
      osSituacao: true,
      atualizadoEm: true,
    },
  },
} satisfies Prisma.OrdemServicoInclude;

export function paraFilaItem(os: Prisma.OrdemServicoGetPayload<{ include: typeof INCLUDE_FILA }>): FilaItem {
  return {
    id: os.id,
    provedorId: os.provedorId,
    provedor: {
      id: os.provedor.id,
      nome: os.provedor.nome,
      cor: os.provedor.cor,
      logoUrl: os.provedor.logoUrl,
      ativo: os.provedor.ativo,
      criadoEm: os.provedor.criadoEm.toISOString(),
    },
    sgpOsId: os.sgpOsId,
    tipoOsId: os.tipoOsId,
    tipoDescricao: os.tipoOs?.descricao ?? null,
    categoria: os.tipoOs?.categoria
      ? {
          id: os.tipoOs.categoria.id,
          nome: os.tipoOs.categoria.nome,
          cor: os.tipoOs.categoria.cor,
          icone: os.tipoOs.categoria.icone,
          slaHorasPadrao: os.tipoOs.categoria.slaHorasPadrao,
          // O mapa desenha interna e externa juntas e precisa distinguir
          // retirada de servico da casa sem uma segunda consulta.
          equipeExterna: os.tipoOs.categoria.equipeExterna,
        }
      : null,
    status: os.status as OsStatus,
    prioridade: os.prioridade as 1 | 2 | 3,
    clienteNome: os.clienteNome,
    clienteDocumento: os.clienteDocumento,
    telefone: os.telefone,
    contratoId: os.contratoId,
    contratoStatus: os.contratoStatus,
    protocolo: os.protocolo,
    conteudo: os.conteudo,
    observacao: os.observacao,
    endereco: {
      logradouro: os.logradouro,
      numero: os.numero,
      bairro: os.bairro,
      cidade: os.cidade,
      lat: os.lat,
      lng: os.lng,
    },
    pop: os.pop,
    usuario: os.usuario,
    dataCadastro: os.dataCadastro?.toISOString() ?? null,
    dataAgendamento: os.dataAgendamento?.toISOString() ?? null,
    // Marcacao cancelada nao roteiriza nada — deixar a ordem antiga faria o
    // app do tecnico listar uma parada que ninguem vai fazer.
    ordemRota: os.agendamento?.status === "marcado" ? os.agendamento.ordemRota : null,
    turnoAgenda: os.agendamento?.status === "marcado" ? os.agendamento.turno : null,
    diaAgenda: os.agendamento?.status === "marcado" ? os.agendamento.dia.toISOString().slice(0, 10) : null,
    agendamentoId: os.agendamento?.status === "marcado" ? os.agendamento.id : null,
    visitaConfirmadaEm: os.agendamento?.status === "marcado" ? (os.agendamento.confirmadoEm?.toISOString() ?? null) : null,
    visitaSgpConfirmadaEm:
      os.agendamento?.status === "marcado" ? (os.agendamento.sgpConfirmadoEm?.toISOString() ?? null) : null,
    agendaResumo: resumoMarcacao(os.agendamento),
    tecnicoId: os.tecnicoId,
    tecnicoNome: os.tecnico?.nome ?? null,
    apoioNomes: os.apoios.map((a) => a.nome),
    tecnicoSgpNome: os.tecnicoSgpNome,
    criadoEm: os.criadoEm.toISOString(),
    atualizadoEm: os.atualizadoEm.toISOString(),
    sincronizadoEm: os.sincronizadoEm.toISOString(),
    // dataCadastro (data real de abertura no SGP) e uma base de SLA mais
    // fiel que criadoEm, que so reflete quando o ISPhub sincronizou pela
    // primeira vez — importante pra OS antigas importadas so agora.
    // SLA efetivo: o do tipo, com fallback pro padrao da categoria (menos
    // configuracao manual por tipo — so precisa mexer quando o tipo foge
    // do padrao da propria categoria).
    sla: calcularSla({
      slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao,
      dataBase: os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm,
    }),
  };
}

/**
 * Teto defensivo de itens devolvidos numa resposta da fila. Alto o bastante
 * pra cobrir toda a operacao aberta (o que de fato importa no dia a dia) sem
 * cortar um provedor; se for ultrapassado, a resposta marca `truncado` e o
 * cliente avisa o usuario a refinar — nunca esconde dados em silencio (foi o
 * bug do corte cego de 500, que fazia o 1o provedor sumir ao entrar o 2o).
 */
const LIMITE_FILA = 2000;

const filtrosSchema = z.object({
  provedorId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? (s.split(",") as OsStatus[]) : undefined)),
  tipoOsId: z.string().uuid().optional(),
  tecnicoId: z.string().uuid().optional(),
  /** "sem_categoria" filtra OS cujo tipo ainda nao foi mapeado a nenhuma categoria. */
  categoriaId: z.union([z.string().uuid(), z.literal("sem_categoria")]).optional(),
  /**
   * Separa a fila operacional do arquivo. "abertos" = OS em OS_STATUS_ABERTOS
   * (trabalho que ainda precisa de acao); "fechados" = o resto, so pra
   * consulta. Sem isso, uma base com muita OS encerrada consome o teto de
   * registros e esconde as abertas, que sao justamente as que importam.
   */
  grupo: z.enum(["abertos", "fechados"]).optional(),
  /**
   * Quem executa a OS. Default "interna": sem o param, a resposta e a fila
   * da equipe ISPhub — e o que Painel e Mapa esperam. A tela de Retiradas
   * pede "externa" explicitamente. Retirada nunca "some": tem tela propria.
   */
  equipe: z.enum(["interna", "externa", "todas"]).default("interna"),
  /**
   * OS PENDENTE: o Painel pede "excluir", a aba Pendentes pede "so". Default
   * "incluir" pra quem nao passa nada (app do tecnico, Mapa, Retiradas) ver o
   * mesmo de antes. Ver filaService.wherePendentes.
   */
  pendentes: z.enum(["incluir", "excluir", "so"]).default("incluir"),
  // Teto de tamanho: `busca` vira ate 5 ILIKE '%...%' sem indice; string
  // gigante so serve pra fazer o banco trabalhar a toa.
  busca: z.string().max(120).optional(),
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  /** So OS com visita MARCADA na agenda ISPhub neste dia — a agenda do tecnico. */
  diaAgenda: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Max mais alto que o padrao de paginacao para suportar o Mapa, que precisa
  // de todas as OS geolocalizadas de uma vez (sem paginacao visual propria).
  pageSize: z.coerce.number().int().min(1).max(1000).default(30),
});

/**
 * Fila de Ordens de Servico de todos os provedores (ou de um so, via filtro),
 * com badge do provedor (cor/logo) e SLA calculado por item. Devolve o
 * conjunto completo do grupo ativo (ate LIMITE_FILA), com `total` exato via
 * count e flag `truncado`; a faceta/ordenacao/paginacao fina acontece no
 * cliente sobre esse conjunto completo. A ISPhub trabalha so com OS.
 *
 * `equipe` recorta quem executa a OS (ver equipeService.ts): default
 * "interna" (fila da equipe ISPhub, usada pelo Painel e pelo Mapa); a tela
 * de Retiradas pede "externa" explicitamente — nunca se misturam.
 */
filaRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const f = filtrosSchema.parse(req.query);

    // provedor: so o proprio provedor. tecnico: so as OS atribuidas a ele
    // mesmo (de qualquer provedor). admin/gestor: livre, com filtro opcional.
    // No AND: o escopo do tecnico usa `OR` (responsavel ou apoio) e a busca abaixo grava `osWhere.OR`.
    const osWhere: any = { AND: [escopoOsWhere(req.user!, f.provedorId)] };
    if (f.status?.length) osWhere.status = { in: f.status };
    else if (f.grupo === "abertos") osWhere.status = { in: OS_STATUS_ABERTOS };
    else if (f.grupo === "fechados") osWhere.status = { notIn: OS_STATUS_ABERTOS };
    if (f.tipoOsId) osWhere.tipoOsId = f.tipoOsId;
    // Filtro de tecnicoId da query so vale pra admin/gestor escolhendo um
    // tecnico especifico — um usuario tecnico nao pode usa-lo pra ver a fila
    // de outro tecnico, o escopo acima ja fixou o dele.
    if (f.tecnicoId && req.user!.role !== UserRole.TECNICO) osWhere.tecnicoId = f.tecnicoId;
    if (f.categoriaId === "sem_categoria") osWhere.tipoOs = { categoriaId: null };
    else if (f.categoriaId) osWhere.tipoOs = { categoriaId: f.categoriaId };
    if (f.diaAgenda) {
      // A agenda ISPhub, nao a data do SGP: visita marcada aqui aparece no
      // mesmo instante, sem esperar o write-back nem o proximo sync.
      osWhere.agendamento = { dia: new Date(`${f.diaAgenda}T00:00:00.000Z`), status: "marcado" };
    }
    if (f.de || f.ate) {
      osWhere.dataAgendamento = {};
      if (f.de) osWhere.dataAgendamento.gte = new Date(f.de);
      if (f.ate) osWhere.dataAgendamento.lte = new Date(f.ate);
    }
    if (f.busca) {
      osWhere.OR = [
        { clienteNome: { contains: f.busca, mode: "insensitive" } },
        { protocolo: { contains: f.busca, mode: "insensitive" } },
        { logradouro: { contains: f.busca, mode: "insensitive" } },
        { contratoId: { contains: f.busca, mode: "insensitive" } },
        { telefone: { contains: f.busca, mode: "insensitive" } },
      ];
    }
    // Recorte de equipe (interna/externa/todas) — sempre no AND, nunca no
    // topo do where: `OR` (busca, acima) e `tipoOs` (filtro de categoria)
    // ja ocupam essas chaves e seriam sobrescritos em silencio.
    //
    // Nao se aplica a TECNICO: a fila dele ja esta escopada a ele, e OS
    // atribuida que a lista esconde e OS perdida. Ver whereEquipeParaUsuario.
    const clausulaEquipe = whereEquipeParaUsuario(f.equipe, req.user!.role);
    if (clausulaEquipe) osWhere.AND = [...(osWhere.AND ?? []), clausulaEquipe];
    // No AND tambem: `status` do topo e apagado pros contadores das abas, e
    // estes tem que respeitar o recorte (o "Fila (N)" do Painel sem pendentes).
    const clausulaPendentes = wherePendentes(f.pendentes);
    if (clausulaPendentes) osWhere.AND = [...osWhere.AND, clausulaPendentes];
    Object.keys(osWhere).forEach((k) => osWhere[k] === undefined && delete osWhere[k]);

    const [ordens, totalOs] = await Promise.all([
      prisma.ordemServico.findMany({
        where: osWhere,
        include: INCLUDE_FILA,
        orderBy: [{ dataAgendamento: "asc" }, { criadoEm: "desc" }],
        take: LIMITE_FILA,
      }),
      // Total real no banco pro filtro atual — base honesta do `truncado`,
      // independente de quantas OS couberam no `take`.
      prisma.ordemServico.count({ where: osWhere }),
    ]);

    const itensOs = ordens.map(paraFilaItem);

    // Ordena e aplica o teto — devolve o conjunto COMPLETO do grupo ativo
    // (todos os provedores), pra o cliente facetar/paginar sobre dados
    // completos. `truncado` avisa honestamente se o total real passou do teto.
    const { itens, total, truncado } = prepararFila(itensOs, totalOs, LIMITE_FILA);
    if (truncado) {
      console.warn(
        `[fila] conjunto truncado: devolvidos ${itens.length} de ${total} (limite ${LIMITE_FILA}). ` +
          `A resposta marca truncado=true; refine filtros/busca pra ver o restante.`,
      );
    }

    // Contagem real por grupo, direto do banco: os contadores das abas nao
    // podem depender do que coube no `take`, senao voltam a mentir quando a
    // base cresce (foi assim que 1000 OS encerradas se passaram por abertas).
    // Ignora o filtro de grupo/status, mas respeita escopo e demais filtros.
    const osWhereSemStatus = { ...osWhere };
    delete osWhereSemStatus.status;
    const [osAbertas, osFechadas, abertasComSla] = await Promise.all([
      prisma.ordemServico.count({ where: { ...osWhereSemStatus, status: { in: OS_STATUS_ABERTOS } } }),
      prisma.ordemServico.count({ where: { ...osWhereSemStatus, status: { notIn: OS_STATUS_ABERTOS } } }),
      // Só os campos que o SLA precisa — o alerta tem que ser o mesmo esteja
      // o usuario na aba de abertas ou na de concluidas.
      //
      // `take` obrigatorio: sem ele esta query carregava TODAS as OS abertas do
      // escopo so pra contar quantas estao vermelhas — cresce linear com a base
      // e e a query mais cara da rota mais chamada do sistema. O teto e o mesmo
      // da fila (LIMITE_FILA), entao o contador nunca fala de mais OS do que a
      // propria lista ja admite ter truncado.
      prisma.ordemServico.findMany({
        where: { ...osWhereSemStatus, status: { in: OS_STATUS_ABERTOS } },
        select: {
          dataAgendamento: true,
          dataCadastro: true,
          criadoEm: true,
          tipoOs: { select: { slaHoras: true, categoria: { select: { slaHorasPadrao: true } } } },
        },
        take: LIMITE_FILA,
      }),
    ]);

    const osSlaEstourado = abertasComSla.filter(
      (os) =>
        calcularSla({
          slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao,
          dataBase: os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm,
        }).semaforo === "vermelho",
    ).length;

    res.json({
      total,
      truncado,
      itens,
      totais: { osAbertas, osFechadas, osSlaEstourado },
    });
  }),
);
