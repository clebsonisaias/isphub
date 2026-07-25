import { mapSgpOsStatus } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { buildConnector } from "./erpConnectorService.js";
import { sugerirCategoriaId } from "./categoriaMatch.js";

/**
 * Motor de sincronizacao: puxa tecnicos, OS e ocorrencias do SGP de um
 * provedor e faz upsert idempotente no espelho local. Chamado tanto pelo
 * scheduler (polling periodico) quanto por um trigger manual (rota
 * POST /provedores/:id/sync, util para testes e para "sincronizar agora").
 */
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

  // --- 1. Tecnicos (precisa vir antes de OS para resolver tecnicoId) ---
  const inicioTecnicos = Date.now();
  try {
    const tecnicos = await connector.listTechnicians();
    for (const t of tecnicos) {
      await prisma.tecnico.upsert({
        where: { provedorId_sgpTecnicoId: { provedorId, sgpTecnicoId: t.sgpTecnicoId } },
        create: { provedorId, sgpTecnicoId: t.sgpTecnicoId, nome: t.nome },
        update: { nome: t.nome },
      });
    }
    await logSync(provedorId, "pull", "tecnicos", true, tecnicos.length, inicioTecnicos);
  } catch (err) {
    ok = false;
    mensagemFinal = mensagem(err);
    await logSync(provedorId, "pull", "tecnicos", false, 0, inicioTecnicos, mensagemFinal);
  }

  // Mapa sgpTecnicoId -> id local, para resolver tecnicoId das OS.
  const tecnicosLocais = await prisma.tecnico.findMany({ where: { provedorId } });
  const tecnicoPorSgpId = new Map(tecnicosLocais.filter((t) => t.sgpTecnicoId).map((t) => [t.sgpTecnicoId!, t.id]));

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
    const ordens = await connector.listServiceOrders();
    for (const raw of ordens) {
      let tipoOsId: string | undefined;
      if (raw.tipoCodigo) {
        const jaExistia = tipoPorSgpCodigo.has(raw.tipoCodigo.trim());
        tipoOsId = await resolverOuCriarTipoOsId(raw.tipoCodigo, raw.tipoDescricao);
        if (!jaExistia) tiposAutoCriados.add(raw.tipoCodigo.trim());
      }
      const campos = {
        tipoOsId,
        status: mapSgpOsStatus(raw.statusCode),
        prioridade: raw.prioridade ?? 2,
        clienteNome: raw.clienteNome,
        clienteDocumento: raw.clienteDocumento,
        contratoId: raw.contratoId,
        contratoStatus: raw.contratoStatus,
        protocolo: raw.protocolo,
        conteudo: raw.conteudo,
        observacao: raw.observacao,
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
        tecnicoId: raw.tecnicoSgpId ? tecnicoPorSgpId.get(raw.tecnicoSgpId) : undefined,
      };
      await prisma.ordemServico.upsert({
        where: { provedorId_sgpOsId: { provedorId, sgpOsId: raw.sgpOsId } },
        create: { provedorId, sgpOsId: raw.sgpOsId, ...campos },
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
