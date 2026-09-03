import {
  mapSgpOsStatus,
  sgpStatusReconhecido,
  OS_STATUS_ABERTOS,
  OsStatus,
  SgpOsStatus,
  type RawOs,
  type ResultadoStatusOs,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { OS_EXTERNA_WHERE, OS_INTERNA_WHERE } from "./equipeService.js";
import { buildConnector } from "./erpConnectorService.js";
import { emitParaTodos, emitParaUsuario } from "./realtimeHub.js";
import { sugerirCategoriaId } from "./categoriaMatch.js";
import { confirmarComSgp, ligarOrfas, reconciliarDoSgp } from "./agendaService.js";

/**
 * Motor de sincronizacao: puxa OS do SGP de um provedor e faz
 * upsert idempotente no espelho local. Chamado tanto pelo scheduler (polling
 * periodico) quanto por um trigger manual (rota POST /provedores/:id/sync,
 * util para testes e para "sincronizar agora").
 *
 * Nao sincroniza tecnicos: tecnico e pessoal da ISPhub (usuario com
 * role=tecnico), nao do SGP do provedor. O tecnicoId da OS so e alterado
 * pelo despacho feito dentro do ISPhub (writebackService.atribuirTecnico) —
 * o sync nunca escreve nesse campo, so no informativo "tecnicoSgpNome".
 */

/**
 * Janela de graca em que o sync nao sobrescreve um campo que acabou de ser
 * alterado por acao humana (writebackService) — cobre a consistencia
 * eventual do lado do SGP (a escrita foi aceita, mas a leitura usada aqui
 * pra sincronizar ainda pode devolver o valor antigo por alguns ciclos).
 * Nao e permanente: passada a janela, o SGP volta a ser a fonte da verdade
 * normalmente. Usada tanto pro status quanto pra observacao (eco de
 * anotacao).
 */
const CAMPO_PROTEGIDO_MS = 5 * 60_000;

/**
 * Teto de contratos cuja geolocalizacao e consultada por ciclo de sync. A
 * listagem de OS do SGP nao traz coordenada, so o cadastro do cliente
 * (/api/ura/clientes/) — entao o mapa depende de um backfill que puxa a geo
 * por contrato. O teto espalha esse backfill por varios ciclos em vez de um
 * estouro de centenas de chamadas de uma vez; o que sobra vai nos proximos.
 */
const GEO_BACKFILL_MAX_POR_SYNC = 30;

/**
 * Teto de OS "desaparecidas" confirmadas por ciclo. Cada confirmacao e uma ida
 * ao SGP; sem teto, um provedor com muita OS antiga viraria uma rajada. O
 * resto vai nos proximos ciclos.
 *
 * 50 e escolha do usuario pra drenar o acumulo que existia antes da correcao
 * (OS fechada no SGP que ficava presa na fila). Com o ciclo em 60s, sao ate 50
 * consultas/min por provedor no pior caso — e so enquanto o acumulo existe;
 * em regime normal a lista de candidatas por ciclo e de poucas unidades.
 */
const DESAPARECIDAS_MAX_POR_SYNC = 50;

/**
 * Quantos 404 SEGUIDOS o SGP precisa dar pra que a OS seja cancelada aqui.
 *
 * Existe porque em ago/2026 o sync cancelou OS que o SGP estava listando no
 * mesmo minuto — o parser nao reconhecia o envelope da consulta individual e
 * "nao entendi" virava "nao existe". A causa daquilo foi corrigida no conector
 * (`ResultadoStatusOs`), e isto e o cinto de seguranca: mesmo com prova
 * positiva, um engano pontual nao tira o cliente da fila. Com o ciclo em 60s,
 * 3 confirmacoes custam poucos minutos de atraso pra limpar OS realmente
 * removida — e valem cada segundo comparadas a um atendimento perdido.
 */
const DESAPARECIMENTOS_PRA_CANCELAR = 3;

/**
 * Apos consultar a geo de um contrato (com ou sem coordenada), so
 * reconsultamos passado este TTL — evita bater no SGP toda vez por um
 * contrato que ele simplesmente nao geolocaliza, mas ainda permite pegar uma
 * coordenada que o provedor venha a cadastrar depois.
 */
const GEO_RECONSULTA_MS = 7 * 24 * 60 * 60_000;

/**
 * Campos de endereco/geo a persistir a partir da LISTAGEM de OS — SO os que a
 * listagem realmente trouxe. A listagem quase nunca traz rua/coordenada (so
 * "pop" e as vezes cidade); incluir um campo ausente como null sobrescreveria
 * o que o backfill (via cadastro do cliente) ja gravou. Sem essa guarda, todo
 * sync zerava endereco e geo, e o mapa/card viviam vazios. lat/lng so entram
 * em par (um sem o outro nao serve pro mapa).
 */
export function camposEnderecoDoListado(endereco: {
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  lat?: number | null;
  lng?: number | null;
}): { logradouro?: string; numero?: string; bairro?: string; cidade?: string; lat?: number; lng?: number } {
  const out: { logradouro?: string; numero?: string; bairro?: string; cidade?: string; lat?: number; lng?: number } = {};
  if (endereco.logradouro != null) out.logradouro = endereco.logradouro;
  if (endereco.numero != null) out.numero = endereco.numero;
  if (endereco.bairro != null) out.bairro = endereco.bairro;
  if (endereco.cidade != null) out.cidade = endereco.cidade;
  if (endereco.lat != null && endereco.lng != null) {
    out.lat = endereco.lat;
    out.lng = endereco.lng;
  }
  return out;
}

/**
 * A partir das OS candidatas a backfill (sem geo, com contrato), devolve ate
 * `max` contratos UNICOS a consultar neste ciclo. O dedupe evita gastar o
 * orcamento de chamadas com o mesmo contrato repetido (varias OS por
 * contrato); o teto espalha o trabalho por varios syncs.
 */
export function contratosParaBackfillGeo(candidatas: { contratoId: string | null }[], max: number): string[] {
  const unicos: string[] = [];
  const vistos = new Set<string>();
  for (const os of candidatas) {
    if (!os.contratoId || vistos.has(os.contratoId)) continue;
    vistos.add(os.contratoId);
    unicos.push(os.contratoId);
    if (unicos.length >= max) break;
  }
  return unicos;
}

/**
 * Reconcilia o status bruto do SGP com o status local atual pra dois casos
 * que o SGP estruturalmente nao consegue distinguir/expressar:
 *  - Cancelada: o SGP so tem "Encerrada" (codigo 1), sem separar cancelado
 *    de concluido — se o local ja sabe que foi cancelada e o SGP diz
 *    "Encerrada" (que mapSgpOsStatus traduz pra Concluida), isso nao
 *    contradiz o cancelamento, entao mantem Cancelada.
 *  - A caminho: o SGP nao tem status pra isso (endpoint /acaminho/ separado,
 *    nao mexe no os_status), entao "A caminho" localmente e um refinamento
 *    de "Aberta" do lado do SGP — se o SGP ainda diz "Aberta", isso nao
 *    contradiz "a caminho", entao mantem. Qualquer outro codigo (progresso
 *    real, ex.: Em execucao) sobrescreve normalmente.
 * Sem isso, toda OS cancelada virava "Concluida" e todo "a caminho" virava
 * "Aberta" de volta assim que a janela de protecao expirava.
 */
export function reconciliarStatus(statusSgp: OsStatus, statusLocalAtual: OsStatus | undefined): OsStatus {
  if (statusLocalAtual === OsStatus.CANCELADA && statusSgp === OsStatus.CONCLUIDA) return OsStatus.CANCELADA;
  if (statusLocalAtual === OsStatus.EM_DESLOCAMENTO && statusSgp === OsStatus.ABERTA) return OsStatus.EM_DESLOCAMENTO;
  return statusSgp;
}

/** O que fazer com uma OS que sumiu da varredura de abertas. */
export type AcaoDesaparecida =
  /** Sem evidencia — nao escreve nada. */
  | { acao: "nao_mexer"; motivo: string }
  /** Ausencia confirmada, mas ainda nao repetida o bastante pra agir. */
  | { acao: "contar_ausencia"; vezes: number }
  /** O SGP diz que ela esta viva: desarma qualquer contagem em andamento. */
  | { acao: "zerar_contador"; statusBruto: number | string }
  /** Sai da fila de abertas. */
  | { acao: "fechar"; status: OsStatus; descricao: string };

/**
 * A regra que decide o destino de uma OS ausente da varredura — pura, porque
 * e ela que erra caro: cancelar tira a OS do Painel e deixa um cliente sem
 * atendimento agendado.
 *
 * A versao anterior morava dentro do laco do sync, misturada com `prisma`, e
 * por isso nunca teve teste. Ela tratava "nao entendi a resposta" como "a OS
 * nao existe" e cancelou OS que o SGP estava listando no mesmo minuto. Aqui os
 * dois casos sao ramos diferentes e sao verificaveis sem banco.
 */
export function decidirSobreDesaparecida(
  r: ResultadoStatusOs,
  os: { status: OsStatus; ausenciasConsecutivas: number },
): AcaoDesaparecida {
  // Duvida nunca autoriza escrita — e o ramo mais importante desta funcao.
  if (r.tipo === "indeterminado") return { acao: "nao_mexer", motivo: r.motivo };

  if (r.tipo === "ausente") {
    const vezes = os.ausenciasConsecutivas + 1;
    if (vezes < DESAPARECIMENTOS_PRA_CANCELAR) return { acao: "contar_ausencia", vezes };
    return {
      acao: "fechar",
      status: OsStatus.CANCELADA,
      descricao: "Removida no SGP — saiu da fila do ISPhub",
    };
  }

  const statusResolvido = mapSgpOsStatus(r.statusBruto);
  // Contradiz a varredura, que se disse completa e nao trouxe esta OS. Nao e
  // motivo pra fechar nada: ou o SGP mudou de ideia entre as duas chamadas, ou
  // ha status nao mapeado aqui.
  if (OS_STATUS_ABERTOS.includes(statusResolvido)) {
    return { acao: "zerar_contador", statusBruto: r.statusBruto };
  }
  // Encerramento e prova positiva por si so — nao espera repeticao.
  return {
    acao: "fechar",
    status: reconciliarStatus(statusResolvido, os.status),
    descricao: `Encerrada no SGP (status "${r.statusBruto}") — saiu da fila do ISPhub`,
  };
}

/**
 * Esta OS merece um aviso em tempo real neste ciclo?
 *
 * So OS NOVA ou com STATUS diferente do espelho. A regra critica e a negativa:
 * um re-sync que reconfirma os mesmos dados nao avisa nada — o polling roda a
 * cada ciclo, e avisar sempre faria a fila do tecnico piscar de 3 em 3 minutos
 * sem nada ter acontecido, treinando ele a ignorar a tela.
 *
 * Status protegido tambem nao avisa: ali o valor do SGP esta sendo ignorado de
 * proposito (acao humana recente, ver CAMPO_PROTEGIDO_MS), entao nao houve
 * mudanca de verdade no espelho.
 */
export function deveAvisarMudanca(
  conhecida: { status: OsStatus } | undefined,
  statusSgp: OsStatus,
  statusProtegido: boolean,
): boolean {
  if (!conhecida) return true; // OS nova
  if (statusProtegido) return false;
  return conhecida.status !== statusSgp;
}

export async function syncProvedor(provedorId: string): Promise<{ ok: boolean; message?: string }> {
  const config = await prisma.erpConfig.findFirst({
    where: { provedorId, tipo: "SGP", ativo: true },
  });
  if (!config) {
    return { ok: false, message: "Integracao SGP nao configurada ou inativa para este provedor" };
  }

  const connector = buildConnector(config);
  let mensagemFinal: string | undefined;
  let ok = true;

  // Mapa (sgpCodigo OU descricao) -> tipoOs.id, para resolver tipoOsId das OS.
  // O catalogo de tipos do SGP e indexado por codigo numerico, mas a
  // listagem de OS (/api/ura/ordemservico/list/) so devolve o "motivo" como
  // texto (ex.: "🚨 Retirada 🚨"), sem o codigo — entao o casamento por
  // codigo sozinho nunca acha nada nesse caso. Indexamos pelos dois para
  // cobrir tanto instancias do SGP que mandam codigo quanto as que so mandam
  // a descricao.
  const tiposLocais = await prisma.tipoOs.findMany({ where: { provedorId } });
  const tipoPorSgpCodigo = new Map<string, string>();
  for (const t of tiposLocais) {
    tipoPorSgpCodigo.set(t.sgpCodigo, t.id);
    tipoPorSgpCodigo.set(t.descricao.trim(), t.id);
  }

  // Categorias ativas, pra sugerir automaticamente a categoria de tipos
  // auto-criados abaixo (motivo que o SGP manda mas nao esta no catalogo).
  const categoriasAtivas = await prisma.categoria.findMany({ where: { ativo: true } });

  /**
   * Resolve o tipoOsId pelo mapa; se o motivo nao existir no catalogo
   * (o endpoint de catalogo do SGP nao expoe todo motivo ja usado
   * historicamente — confirmado em producao: "Corretiva", "Preventiva" etc
   * aparecem em OS reais mas nunca no catalogo importado), cria um TipoOs
   * novo na hora em vez de deixar a OS orfa pra sempre. O admin pode depois
   * ajustar categoria/SLA normalmente na tela de Tipos de OS.
   */
  async function resolverOuCriarTipoOsId(tipoCodigo: string, tipoDescricao?: string | null): Promise<string> {
    const chave = tipoCodigo.trim();
    const existente = tipoPorSgpCodigo.get(chave);
    if (existente) return existente;

    const descricao = tipoDescricao?.trim() || chave;
    const novo = await prisma.tipoOs.create({
      data: {
        provedorId,
        sgpCodigo: chave,
        descricao,
        categoriaId: sugerirCategoriaId(descricao, categoriasAtivas),
        visivel: true,
      },
    });
    tipoPorSgpCodigo.set(novo.sgpCodigo, novo.id);
    tipoPorSgpCodigo.set(novo.descricao.trim(), novo.id);
    return novo.id;
  }

  // --- 2. Ordens de Servico ---
  const inicioOs = Date.now();
  const tiposAutoCriados = new Set<string>();
  // Valores de status que o SGP mandou e o mapeamento nao entendeu (caem no
  // fallback "aberta"). Logado ao fim do ciclo pra um formato novo nao passar
  // despercebido, como aconteceu com o rotulo textual.
  const statusNaoReconhecidos = new Set<string>();
  try {
    // Estado local de toda OS ja conhecida deste provedor: usado tanto pra
    // saber quais campos estao numa janela de protecao (statusAlteradoEm /
    // observacaoAlteradaEm, alterados ha pouco por acao humana) quanto pra
    // reconciliar o status bruto do SGP com o que o local ja sabe (ver
    // reconciliarStatus) — precisa do status atual de qualquer OS existente,
    // nao so das recem-alteradas.
    const osConhecidas = await prisma.ordemServico.findMany({
      where: { provedorId },
      // `id` e `tecnicoId` entram pro aviso em tempo real no fim do sync (ver
      // "avisa quem precisa saber" abaixo) — mesma query, custo zero.
      select: {
        id: true,
        sgpOsId: true,
        status: true,
        tecnicoId: true,
        statusAlteradoEm: true,
        observacaoAlteradaEm: true,
        contratoStatusAlteradoEm: true,
        ausenciasConsecutivas: true,
      },
    });
    const limiteProtecao = Date.now() - CAMPO_PROTEGIDO_MS;
    const statusProtegido = new Set(
      osConhecidas.filter((o) => o.statusAlteradoEm && o.statusAlteradoEm.getTime() > limiteProtecao).map((o) => o.sgpOsId),
    );
    const observacaoProtegida = new Set(
      osConhecidas
        .filter((o) => o.observacaoAlteradaEm && o.observacaoAlteradaEm.getTime() > limiteProtecao)
        .map((o) => o.sgpOsId),
    );
    /*
     * Terceiro campo protegido, mesma janela dos dois acima. O SGP aceita a
     * troca de status do contrato mas a leitura seguinte ainda devolve o valor
     * antigo por alguns ciclos — sem isto, o proximo sync desfaria na tela o
     * que a pessoa acabou de fazer, e ela clicaria de novo.
     */
    const contratoStatusProtegido = new Set(
      osConhecidas
        .filter((o) => o.contratoStatusAlteradoEm && o.contratoStatusAlteradoEm.getTime() > limiteProtecao)
        .map((o) => o.sgpOsId),
    );
    const statusLocalPorSgpId = new Map(osConhecidas.map((o) => [o.sgpOsId, o.status as OsStatus]));
    // Quem ja existia, pra distinguir "OS nova" de "OS que mudou" e saber a
    // quem avisar (o tecnico dono dela).
    const conhecidaPorSgpId = new Map(osConhecidas.map((o) => [o.sgpOsId, o]));
    /** OS novas ou com status alterado neste ciclo — base do aviso em tempo real. */
    const mexidas: { id: string | null; tecnicoId: string | null }[] = [];

    // O SGP nao documenta o comportamento do filtro "status" quando ausente —
    // na pratica, uma OS que foi encerrada direto no SGP (fora do ISPhub)
    // parava de aparecer na listagem sem filtro e o espelho local ficava
    // preso pra sempre no ultimo status conhecido (ex.: "Aberta" por meses
    // depois de encerrada de verdade). Busca cada status conhecido
    // explicitamente pra garantir que o ISPhub sempre reflita o status real
    // do SGP, nao um subconjunto implicito dele.
    //
    // SO os tres status ABERTOS aqui — ENCERRADA saiu de proposito. A listagem
    // do SGP e ordenada por DATA DE CRIACAO, nao de fechamento: uma varredura
    // de encerradas, completa ou nao, nao ajuda a achar quem fechou
    // recentemente (uma OS criada em 2024 e fechada hoje fica espalhada no
    // meio de 72 mil registros, nao no topo). Por isso nem uma pagina limitada
    // de encerradas serve de atalho — quem prova que uma OS fechou e o bloco
    // abaixo, que confere uma a uma so as que sumiram das abertas. Ver
    // `obterStatusOs` na interface do connector.
    //
    // `varreduraCompleta` (AND das tres): sem ela, reconciliar uma OS "sumida"
    // com base numa varredura que o proprio SGP cortou no meio seria a mesma
    // classe de bug que a paginacao ja resolveu pras abertas — so que agora
    // cancelando OS por engano.
    const ordens: RawOs[] = [];
    let varreduraCompleta = true;
    for (const status of [SgpOsStatus.ABERTA, SgpOsStatus.EM_EXECUCAO, SgpOsStatus.PENDENTE]) {
      const resultado = await connector.listServiceOrders({ status });
      ordens.push(...resultado.itens);
      if (!resultado.completo) varreduraCompleta = false;
    }
    for (const raw of ordens) {
      let tipoOsId: string | undefined;
      if (raw.tipoCodigo) {
        const jaExistia = tipoPorSgpCodigo.has(raw.tipoCodigo.trim());
        tipoOsId = await resolverOuCriarTipoOsId(raw.tipoCodigo, raw.tipoDescricao);
        if (!jaExistia) tiposAutoCriados.add(raw.tipoCodigo.trim());
      }
      if (!sgpStatusReconhecido(raw.statusCode)) statusNaoReconhecidos.add(String(raw.statusCode));
      const statusSgp = reconciliarStatus(mapSgpOsStatus(raw.statusCode), statusLocalPorSgpId.get(raw.sgpOsId));
      const campos = {
        tipoOsId,
        ...(statusProtegido.has(raw.sgpOsId) ? {} : { status: statusSgp }),
        prioridade: raw.prioridade ?? 2,
        clienteNome: raw.clienteNome,
        clienteDocumento: raw.clienteDocumento,
        contratoId: raw.contratoId,
        ...(contratoStatusProtegido.has(raw.sgpOsId) ? {} : { contratoStatus: raw.contratoStatus }),
        protocolo: raw.protocolo,
        // conteudo nao tem protecao porque nao ha edicao local: a API do SGP
        // nao expoe escrita nesse campo (ver connector.ts addOsNote).
        conteudo: raw.conteudo,
        ...(observacaoProtegida.has(raw.sgpOsId) ? {} : { observacao: raw.observacao }),
        // Endereco/geo: so os campos que a listagem REALMENTE trouxe. A
        // listagem quase nunca traz rua/coordenada; setar como null zeraria o
        // que o backfill puxou do cadastro do cliente. Ver camposEnderecoDoListado.
        ...camposEnderecoDoListado(raw.endereco),
        pop: raw.pop,
        usuario: raw.usuario,
        dataCadastro: raw.dataCadastro ? new Date(raw.dataCadastro) : null,
        dataAgendamento: raw.dataAgendamento ? new Date(raw.dataAgendamento) : null,
        tecnicoSgpNome: raw.tecnicoSgpNome,
        /*
         * Ver a OS na varredura zera a contagem de sumicos. E o UNICO ponto de
         * reset, e ele e automatico: qualquer reaparecimento desarma o
         * cancelamento em andamento, sem ninguem precisar lembrar disso.
         */
        ausenciasConsecutivas: 0,
      };
      await prisma.ordemServico.upsert({
        where: { provedorId_sgpOsId: { provedorId, sgpOsId: raw.sgpOsId } },
        create: { provedorId, sgpOsId: raw.sgpOsId, status: statusSgp, ...campos },
        update: { ...campos, sincronizadoEm: new Date() },
      });

      const conhecida = conhecidaPorSgpId.get(raw.sgpOsId);
      if (deveAvisarMudanca(conhecida as { status: OsStatus } | undefined, statusSgp, statusProtegido.has(raw.sgpOsId))) {
        // OS nova nao tem id/tecnico aqui (acabou de nascer): entra so pra
        // disparar o aviso geral da fila de quem despacha.
        mexidas.push({ id: conhecida?.id ?? null, tecnicoId: conhecida?.tecnicoId ?? null });
      }
    }
    if (statusNaoReconhecidos.size > 0) {
      console.warn(
        `[sync] status de OS nao reconhecido(s) no provedor ${provedorId}, tratados como "aberta": ${[...statusNaoReconhecidos].join(" | ")}`,
      );
    }
    // --- 2b. Agenda: casar o espelho com as marcacoes ---
    // Duas direcoes, e as duas sao normais:
    //
    // 1) ORFAS — o atendimento marca no instante em que abre a OS no SGP, e o
    //    espelho so a ve neste ciclo. Ate aqui a marcacao existia sem OS.
    // 2) DO SGP — o provedor agendou direto no SGP dele. Sem trazer isso pra
    //    agenda, a vaga e consumida na rua e a grade continua mostrando o turno
    //    vazio: exatamente o engano da planilha, so que invisivel.
    //
    // Best-effort: uma agenda desalinhada e ruim, um sync derrubado e pior.
    try {
      await ligarOrfas(provedorId);
      await confirmarComSgp(provedorId);
      const semMarcacao = await prisma.ordemServico.findMany({
        where: {
          provedorId,
          dataAgendamento: { not: null },
          agendamento: null,
          status: { in: OS_STATUS_ABERTOS },
        },
        select: { id: true, sgpOsId: true, dataAgendamento: true, bairro: true, pop: true },
        take: 500,
      });
      const criadas = await reconciliarDoSgp(
        semMarcacao
          .filter((o): o is typeof o & { dataAgendamento: Date } => o.dataAgendamento != null)
          .map((o) => ({
            provedorId,
            sgpOsId: o.sgpOsId,
            ordemServicoId: o.id,
            dataAgendamento: o.dataAgendamento,
            // `pop` primeiro: vem sempre na listagem, enquanto `bairro` so
            // aparece depois do backfill do cadastro (30 por ciclo, TTL 7d).
            regiao: o.pop ?? o.bairro ?? null,
          })),
      );
      if (criadas > 0) console.log(`[sync] agenda: ${criadas} OS agendadas no SGP trazidas pra grade (provedor ${provedorId})`);
    } catch (e) {
      console.warn(`[sync] agenda: reconciliacao falhou no provedor ${provedorId}:`, e);
    }

    // --- 3. Backfill do cadastro do cliente (endereco de rua + geo + telefone) ---
    // A listagem de OS nao traz nada disso; o cadastro do cliente
    // (/api/ura/clientes/) traz. Sem isso o Mapa fica vazio e o card so mostra
    // o POP. Puxa o cadastro dos contratos ainda nao consultados, deduplicando
    // por contrato e com teto por ciclo pra nao estourar o SGP — o resto vai
    // nos proximos syncs. geoConsultadoEm marca a tentativa (com TTL) pra nao
    // reconsultar pra sempre um contrato que o SGP nao detalha. Best-effort:
    // nao derruba o sync de OS.
    try {
      const reconsultarAntesDe = new Date(Date.now() - GEO_RECONSULTA_MS);
      const candidatas = await prisma.ordemServico.findMany({
        where: {
          provedorId,
          contratoId: { not: null },
          OR: [{ geoConsultadoEm: null }, { geoConsultadoEm: { lt: reconsultarAntesDe } }],
        },
        select: { contratoId: true },
        // Mais recentes primeiro: tendem a ser as abertas, que o Mapa mostra.
        orderBy: { dataCadastro: "desc" },
      });
      const contratos = contratosParaBackfillGeo(candidatas, GEO_BACKFILL_MAX_POR_SYNC);
      if (contratos.length > 0) {
        let comCoordenada = 0;
        // Contato e o campo que a operacao mais sente falta (e o que o card
        // mostra como "—"), mas o log so contava coordenada — nao dava pra
        // saber se o telefone estava vindo ou nao sem abrir o banco.
        let comTelefone = 0;
        let semCadastro = 0;
        for (const contratoId of contratos) {
          const cadastro = await connector.getContratoCadastro(contratoId);
          // Marca a tentativa sempre (mesmo sem dado ou com falha), pra o TTL
          // controlar a reconsulta em vez de bater no SGP todo ciclo. So
          // grava um campo quando veio preenchido (nao apaga o que ja existe).
          const dados: Record<string, unknown> = { geoConsultadoEm: new Date() };
          if (cadastro) {
            if (cadastro.lat != null && cadastro.lng != null) {
              dados.lat = cadastro.lat;
              dados.lng = cadastro.lng;
              comCoordenada++;
            }
            if (cadastro.logradouro != null) dados.logradouro = cadastro.logradouro;
            if (cadastro.numero != null) dados.numero = cadastro.numero;
            if (cadastro.bairro != null) dados.bairro = cadastro.bairro;
            if (cadastro.cidade != null) dados.cidade = cadastro.cidade;
            if (cadastro.telefone != null) {
              dados.telefone = cadastro.telefone;
              comTelefone++;
            }
          } else {
            semCadastro++;
          }
          await prisma.ordemServico.updateMany({ where: { provedorId, contratoId }, data: dados });
        }
        const contratosPendentes = new Set(candidatas.map((c) => c.contratoId)).size - contratos.length;
        console.log(
          `[sync] cadastro backfill provedor ${provedorId}: ${contratos.length} contrato(s) — ` +
            `${comCoordenada} com coordenada, ${comTelefone} com telefone, ${semCadastro} sem cadastro no SGP` +
            (contratosPendentes > 0 ? `; ${contratosPendentes} pendente(s) pros proximos ciclos` : ""),
        );
      }
    } catch (err) {
      console.warn(`[sync] cadastro backfill falhou no provedor ${provedorId}:`, err instanceof Error ? err.message : err);
    }

    /*
     * --- CONFERENCIA DE FUNIL ---
     *
     * A pergunta "por que a tela mostra menos OS que o SGP?" so se responde
     * comparando os MESMOS numeros em cada etapa. Ate aqui havia so as pontas
     * (o SGP na origem, a tela no fim) e o meio era opaco.
     *
     * Recebido = o que o SGP devolveu em status aberto neste ciclo.
     * Espelho  = o que ficou gravado como aberto pra este provedor.
     * Interna  = o recorte que o Painel mostra; Externa = o que vai pra
     *            Retiradas. Se Recebido == Espelho == Interna + Externa, nao
     *            ha perda: a diferenca que a pessoa ve na tela e recorte, nao
     *            registro faltando. Se Recebido > Espelho, ha perda de fato e
     *            ela esta na gravacao.
     */
    const recebidasAbertas = ordens.filter((o) => OS_STATUS_ABERTOS.includes(mapSgpOsStatus(o.statusCode))).length;
    const [espelhoAbertas, espelhoInternas, espelhoExternas] = await Promise.all([
      prisma.ordemServico.count({ where: { provedorId, status: { in: OS_STATUS_ABERTOS } } }),
      prisma.ordemServico.count({
        where: { provedorId, status: { in: OS_STATUS_ABERTOS }, AND: [OS_INTERNA_WHERE] },
      }),
      prisma.ordemServico.count({
        where: { provedorId, status: { in: OS_STATUS_ABERTOS }, AND: [OS_EXTERNA_WHERE] },
      }),
    ]);
    console.log(
      `[funil] provedor ${provedorId}: SGP devolveu ${recebidasAbertas} aberta(s) | espelho tem ${espelhoAbertas} ` +
        `(${espelhoInternas} interna(s) no Painel + ${espelhoExternas} externa(s) em Retiradas)` +
        `${recebidasAbertas !== espelhoAbertas ? " — DIVERGENCIA na gravacao" : ""}`,
    );

    /*
     * Quebra por TIPO do SGP -> CATEGORIA do ISPhub.
     *
     * "Instalação" nao existe no SGP: e categoria do ISPhub, montada por
     * palavra-chave sobre a descricao do tipo. Quando alguem conta 29 no SGP e
     * ve 18 aqui, a diferenca quase sempre esta neste mapa — um tipo que a
     * pessoa considera instalacao caiu noutra categoria, em nenhuma, ou numa
     * marcada como equipe externa (que sai do Painel e vai pra Retiradas).
     *
     * Sem esta linha o mapa era invisivel: dava pra ver o total e o total por
     * categoria, nunca QUAL tipo alimentou qual categoria.
     */
    const porTipo = await prisma.ordemServico.groupBy({
      by: ["tipoOsId"],
      where: { provedorId, status: { in: OS_STATUS_ABERTOS } },
      _count: { _all: true },
    });
    const tipos = await prisma.tipoOs.findMany({
      where: { id: { in: porTipo.map((g) => g.tipoOsId).filter((v): v is string => !!v) } },
      select: { id: true, sgpCodigo: true, descricao: true, categoria: { select: { nome: true, equipeExterna: true } } },
    });
    const porId = new Map(tipos.map((x) => [x.id, x]));
    const linhas = porTipo
      .sort((a, b) => b._count._all - a._count._all)
      .map((g) => {
        const tipo = g.tipoOsId ? porId.get(g.tipoOsId) : undefined;
        const cat = tipo?.categoria;
        const destino = !cat ? "NAO CLASSIFICADO (fora das facetas)" : cat.equipeExterna ? `${cat.nome} [Retiradas]` : cat.nome;
        return `    ${String(g._count._all).padStart(4)}  ${tipo?.descricao ?? "(sem tipo)"} (cod ${tipo?.sgpCodigo ?? "-"})  ->  ${destino}`;
      });
    console.log(`[funil] provedor ${provedorId} — abertas por tipo do SGP:\n${linhas.join("\n")}`);

    // --- OS que SAIU da fila de abertas ---
    // O nome mudou de "OS que SUMIU do SGP" porque so descrevia metade dos
    // casos. O espelho tem que refletir o SGP nos dois sentidos:
    //
    //  - a OS foi REMOVIDA do SGP (raro) — ja tratado, ver contrato 1672.
    //  - a OS foi FECHADA no SGP (o caso comum) — nao era tratado. A OS sumia
    //    das tres varreduras de aberta acima, `osExisteNoSgp` respondia "sim,
    //    existe" (existe, so nao esta mais aberta) e o codigo antigo fazia
    //    `continue`. Nada acontecia, em todo ciclo, pra sempre — a OS ficava
    //    "aberta" no ISPhub muito depois de fechada no SGP de verdade.
    //
    // Ausencia da listagem de abertas NAO basta como prova, sozinha: pode ser
    // instabilidade ou uma varredura truncada (ver `varreduraCompleta` acima).
    // So confirma OS por OS quando as tres vieram completas — senao, uma
    // varredura truncada faria uma OS que so caiu numa pagina que o SGP nao
    // devolveu parecer "fechada" por engano.
    if (!varreduraCompleta) {
      console.warn(
        `[sync] provedor ${provedorId}: varredura de abertas incompleta neste ciclo — ` +
          "pulando a reconciliacao de OS que saiu da fila (nao ha evidencia confiavel de ausencia).",
      );
    } else {
      const vistos = new Set(ordens.map((o) => o.sgpOsId));
      const candidatas = osConhecidas.filter(
        (o) => OS_STATUS_ABERTOS.includes(o.status as OsStatus) && !vistos.has(o.sgpOsId),
      );
      const saiuDaFila = candidatas.slice(0, DESAPARECIDAS_MAX_POR_SYNC);
      if (candidatas.length > saiuDaFila.length) {
        console.log(
          `[sync] provedor ${provedorId}: ${saiuDaFila.length} de ${candidatas.length} OS fora da fila de abertas ` +
            `confirmadas neste ciclo — o restante fica pros proximos.`,
        );
      }

      for (const os of saiuDaFila) {
        // `obterStatusOs` e nao `obterFichaOs`: a ficha e tolerante a falha de
        // fonte (devolve o que conseguir), e usar o silencio dela como prova de
        // ausencia transformaria instabilidade do SGP em cancelamento em massa.
        let resposta: ResultadoStatusOs;
        try {
          resposta = await connector.obterStatusOs(os.sgpOsId);
        } catch (e) {
          // O conector do SGP nao lanca (converte tudo em ResultadoStatusOs),
          // mas a INTERFACE nao garante isso pros outros — e uma excecao aqui
          // abortaria o ciclo inteiro do provedor, nao so esta OS.
          resposta = {
            tipo: "indeterminado",
            motivo: `conector lancou: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
        const decisao = decidirSobreDesaparecida(resposta, {
          status: os.status as OsStatus,
          ausenciasConsecutivas: os.ausenciasConsecutivas,
        });

        if (decisao.acao === "nao_mexer") {
          console.warn(
            `[sync] OS ${os.sgpOsId} do provedor ${provedorId}: sumiu da varredura mas nao deu pra ` +
              `confirmar no SGP (${decisao.motivo}) — nao mexido.`,
          );
          continue;
        }

        if (decisao.acao === "contar_ausencia") {
          await prisma.ordemServico.update({
            where: { id: os.id },
            data: { ausenciasConsecutivas: decisao.vezes },
          });
          console.warn(
            `[sync] OS ${os.sgpOsId} do provedor ${provedorId}: 404 no SGP ` +
              `(${decisao.vezes}/${DESAPARECIMENTOS_PRA_CANCELAR}) — mantida na fila ate confirmar.`,
          );
          continue;
        }

        if (decisao.acao === "zerar_contador") {
          await prisma.ordemServico.update({ where: { id: os.id }, data: { ausenciasConsecutivas: 0 } });
          console.warn(
            `[sync] OS ${os.sgpOsId} do provedor ${provedorId}: sumiu da varredura de abertas mas ` +
              `obterStatusOs devolveu status "${decisao.statusBruto}" (ainda aberto) — nao mexido, investigar.`,
          );
          continue;
        }

        await prisma.$transaction([
          prisma.ordemServico.update({
            where: { id: os.id },
            data: { status: decisao.status, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
          }),
          // Registra o MOTIVO: sem isto, a OS muda de status e ninguem sabe
          // por que — parece que alguem mexeu sem avisar.
          prisma.osEvento.create({
            data: {
              ordemServicoId: os.id,
              tipo: "status",
              descricao: decisao.descricao,
              // SEM `autorId`, e isso nao e omissao: foi o SGP que encerrou, nao
              // uma pessoa daqui. O BI de produtividade le exatamente essa
              // ausencia como "fechou por fora do app" — atribuir a alguem
              // seria creditar a um tecnico um trabalho que ninguem registrou.
              statusDe: os.status,
              statusPara: decisao.status,
            },
          }),
        ]);
        mexidas.push({ id: os.id, tecnicoId: os.tecnicoId });
        console.warn(
          `[sync] OS ${os.sgpOsId} do provedor ${provedorId} saiu da fila de abertas — ` +
            `${decisao.descricao}, virou ${decisao.status} no espelho.`,
        );
      }
    }

    // --- Avisa quem precisa saber (tempo real) ---
    // Antes o sync gravava e ficava calado: uma OS criada ou encerrada no SGP
    // entrava no banco e o app so descobria quando o tecnico resolvia abrir ou
    // arrastar a tela. Best-effort e DEPOIS da escrita, como todo uso de SSE
    // aqui — falha de aviso nunca derruba o sync.
    if (mexidas.length > 0) {
      const em = new Date().toISOString();
      // Ao tecnico dono da OS: refaz a fila DELE e o detalhe, se estiver aberto.
      for (const m of mexidas) {
        if (m.tecnicoId && m.id) emitParaUsuario(m.tecnicoId, { tipo: "os-alterada", osId: m.id, em });
      }
      // E um aviso geral pra fila de quem despacha (gestor/admin no web) — OS
      // nova chega sem tecnico, entao nao ha a quem enderecar. Sem osId de
      // proposito: o cliente so invalida a fila, que e escopada no servidor.
      emitParaTodos({ tipo: "os-alterada", em });
      console.log(`[sync] provedor ${provedorId}: ${mexidas.length} OS nova(s)/alterada(s) — avisado em tempo real`);
    }

    const msgTipos =
      tiposAutoCriados.size > 0
        ? `${tiposAutoCriados.size} tipo(s) de OS criado(s) automaticamente (nao estavam no catalogo importado): ${Array.from(tiposAutoCriados).slice(0, 15).join(" | ")}`
        : undefined;
    await logSync(provedorId, "pull", "os", true, ordens.length, inicioOs, msgTipos);
  } catch (err) {
    ok = false;
    mensagemFinal = mensagem(err);
    await logSync(provedorId, "pull", "os", false, 0, inicioOs, mensagemFinal);
  }

  await prisma.erpConfig.update({
    where: { id: config.id },
    data: { ultimaSyncEm: new Date(), ultimaSyncOk: ok, ultimaSyncMensagem: mensagemFinal ?? "Sync OK" },
  });

  return { ok, message: mensagemFinal };
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function logSync(
  provedorId: string,
  direcao: "pull" | "push",
  recurso: string,
  ok: boolean,
  quantidade: number,
  inicioMs: number,
  mensagem?: string,
) {
  await prisma.syncLog.create({
    data: {
      provedorId,
      direcao,
      recurso,
      ok,
      quantidade,
      mensagem,
      duracaoMs: Date.now() - inicioMs,
    },
  });
}
