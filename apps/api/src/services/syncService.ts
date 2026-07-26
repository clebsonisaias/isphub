import { mapSgpOsStatus, OsStatus, SgpOsStatus, type RawOs } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { buildConnector } from "./erpConnectorService.js";
import { sugerirCategoriaId } from "./categoriaMatch.js";

/**
 * Motor de sincronizacao: puxa OS e ocorrencias do SGP de um provedor e faz
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
  try {
    // Estado local de toda OS ja conhecida deste provedor: usado tanto pra
    // saber quais campos estao numa janela de protecao (statusAlteradoEm /
    // observacaoAlteradaEm, alterados ha pouco por acao humana) quanto pra
    // reconciliar o status bruto do SGP com o que o local ja sabe (ver
    // reconciliarStatus) — precisa do status atual de qualquer OS existente,
    // nao so das recem-alteradas.
    const osConhecidas = await prisma.ordemServico.findMany({
      where: { provedorId },
      select: {
        sgpOsId: true,
        status: true,
        statusAlteradoEm: true,
        observacaoAlteradaEm: true,
        conteudoAlteradoEm: true,
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
    const conteudoProtegido = new Set(
      osConhecidas
        .filter((o) => o.conteudoAlteradoEm && o.conteudoAlteradoEm.getTime() > limiteProtecao)
        .map((o) => o.sgpOsId),
    );
    const statusLocalPorSgpId = new Map(osConhecidas.map((o) => [o.sgpOsId, o.status as OsStatus]));

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
        ...(conteudoProtegido.has(raw.sgpOsId) ? {} : { conteudo: raw.conteudo }),
        ...(observacaoProtegida.has(raw.sgpOsId) ? {} : { observacao: raw.observacao }),
        logradouro: raw.endereco.logradouro,
        numero: raw.endereco.numero,
        bairro: raw.endereco.bairro,
        cidade: raw.endereco.cidade,
        lat: raw.endereco.lat,
        lng: raw.endereco.lng,
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

  // --- 3. Ocorrencias ---
  const inicioOcorrencias = Date.now();
  try {
    const ocorrencias = await connector.listOccurrences();
    for (const raw of ocorrencias) {
      const campos = {
        tipo: raw.tipo,
        status: raw.status,
        conteudo: raw.conteudo,
        responsavel: raw.responsavel,
        clienteNome: raw.clienteNome,
        contratoId: raw.contratoId,
        contratoStatus: raw.contratoStatus,
        pop: raw.pop,
        metodo: raw.metodo,
        usuario: raw.usuario,
        dataCadastro: raw.dataCadastro ? new Date(raw.dataCadastro) : null,
        dataAgendamento: raw.dataAgendamento ? new Date(raw.dataAgendamento) : null,
        dataFinalizacao: raw.dataFinalizacao ? new Date(raw.dataFinalizacao) : null,
      };
      await prisma.ocorrencia.upsert({
        where: { provedorId_sgpNumero: { provedorId, sgpNumero: raw.sgpNumero } },
        create: { provedorId, sgpNumero: raw.sgpNumero, ...campos },
        update: { ...campos, sincronizadoEm: new Date() },
      });
    }
    await logSync(provedorId, "pull", "ocorrencia", true, ocorrencias.length, inicioOcorrencias);
  } catch (err) {
    ok = false;
    mensagemFinal = mensagem(err);
    await logSync(provedorId, "pull", "ocorrencia", false, 0, inicioOcorrencias, mensagemFinal);
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
