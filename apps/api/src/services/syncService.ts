import { mapSgpOsStatus, sgpStatusReconhecido, OS_STATUS_ABERTOS, OsStatus, SgpOsStatus, type RawOs } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { buildConnector } from "./erpConnectorService.js";
import { emitParaTodos, emitParaUsuario } from "./realtimeHub.js";
import { sugerirCategoriaId } from "./categoriaMatch.js";

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
 */
const DESAPARECIDAS_MAX_POR_SYNC = 20;

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
      select: { id: true, sgpOsId: true, status: true, tecnicoId: true, statusAlteradoEm: true, observacaoAlteradaEm: true },
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
    const ordens: RawOs[] = [];
    for (const status of [SgpOsStatus.ABERTA, SgpOsStatus.EM_EXECUCAO, SgpOsStatus.PENDENTE, SgpOsStatus.ENCERRADA]) {
      ordens.push(...(await connector.listServiceOrders({ status })));
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
        contratoStatus: raw.contratoStatus,
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
            if (cadastro.telefone != null) dados.telefone = cadastro.telefone;
          }
          await prisma.ordemServico.updateMany({ where: { provedorId, contratoId }, data: dados });
        }
        const contratosPendentes = new Set(candidatas.map((c) => c.contratoId)).size - contratos.length;
        console.log(
          `[sync] cadastro backfill provedor ${provedorId}: ${comCoordenada}/${contratos.length} contrato(s) com coordenada` +
            (contratosPendentes > 0 ? `; ${contratosPendentes} contrato(s) pendente(s) pros proximos ciclos` : ""),
        );
      }
    } catch (err) {
      console.warn(`[sync] cadastro backfill falhou no provedor ${provedorId}:`, err instanceof Error ? err.message : err);
    }

    // --- OS que SUMIU do SGP ---
    // O espelho tem que refletir o SGP nos dois sentidos. Faltava este: uma OS
    // apagada por la ficava aqui pra sempre no ultimo status conhecido, e a
    // acao do tecnico nela batia num 404 ("O SGP nao encontrou esta OS") —
    // exatamente o erro visto no contrato 1672.
    //
    // Ausencia da listagem NAO basta como prova: pode ser instabilidade ou
    // filtro. Confirma uma por uma na ficha por ID, e SO age com evidencia
    // positiva de que a OS nao existe mais. Teto por ciclo pra nao virar
    // rajada no SGP; o resto vai nos proximos.
    const vistos = new Set(ordens.map((o) => o.sgpOsId));
    const desaparecidas = osConhecidas
      .filter((o) => OS_STATUS_ABERTOS.includes(o.status as OsStatus) && !vistos.has(o.sgpOsId))
      .slice(0, DESAPARECIDAS_MAX_POR_SYNC);

    for (const os of desaparecidas) {
      let confirmadoAusente = false;
      try {
        // `osExisteNoSgp` e nao `obterFichaOs`: a ficha e tolerante a falha de
        // fonte (devolve o que conseguir, ou null), e usar null dela como prova
        // de ausencia transformaria uma instabilidade do SGP em cancelamento em
        // massa. Este metodo PROPAGA erro de transporte — cai no catch abaixo.
        confirmadoAusente = !(await connector.osExisteNoSgp(os.sgpOsId));
      } catch {
        // Falha na confirmacao = nenhuma evidencia. NAO mexe: marcar OS em
        // massa por causa de uma instabilidade do SGP seria muito pior que
        // deixar uma OS velha na fila.
        continue;
      }
      if (!confirmadoAusente) continue;

      await prisma.$transaction([
        prisma.ordemServico.update({
          where: { id: os.id },
          data: { status: OsStatus.CANCELADA, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
        }),
        // Registra o MOTIVO: sem isto, a OS aparece cancelada e ninguem sabe
        // por que — parece que alguem cancelou.
        prisma.osEvento.create({
          data: {
            ordemServicoId: os.id,
            tipo: "status",
            descricao: "Removida no SGP — saiu da fila do ISPhub",
          },
        }),
      ]);
      mexidas.push({ id: os.id, tecnicoId: os.tecnicoId });
      console.warn(`[sync] OS ${os.sgpOsId} nao existe mais no SGP do provedor ${provedorId} — cancelada no espelho`);
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
