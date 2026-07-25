import { mapSgpOsStatus } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { buildConnector } from "./erpConnectorService.js";

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

  // Mapa sgpCodigo -> tipoOs.id, para resolver tipoOsId das OS.
  const tiposLocais = await prisma.tipoOs.findMany({ where: { provedorId } });
  const tipoPorSgpCodigo = new Map(tiposLocais.map((t) => [t.sgpCodigo, t.id]));

  // --- 2. Ordens de Servico ---
  const inicioOs = Date.now();
  try {
    const ordens = await connector.listServiceOrders();
    for (const raw of ordens) {
      await prisma.ordemServico.upsert({
        where: { provedorId_sgpOsId: { provedorId, sgpOsId: raw.sgpOsId } },
        create: {
          provedorId,
          sgpOsId: raw.sgpOsId,
          tipoOsId: raw.tipoCodigo ? tipoPorSgpCodigo.get(raw.tipoCodigo) : undefined,
          status: mapSgpOsStatus(raw.statusCode),
          prioridade: raw.prioridade ?? 2,
          clienteNome: raw.clienteNome,
          clienteDocumento: raw.clienteDocumento,
          contratoId: raw.contratoId,
          protocolo: raw.protocolo,
          conteudo: raw.conteudo,
          observacao: raw.observacao,
          logradouro: raw.endereco.logradouro,
          numero: raw.endereco.numero,
          bairro: raw.endereco.bairro,
          cidade: raw.endereco.cidade,
          lat: raw.endereco.lat,
          lng: raw.endereco.lng,
          dataAgendamento: raw.dataAgendamento ? new Date(raw.dataAgendamento) : null,
          tecnicoId: raw.tecnicoSgpId ? tecnicoPorSgpId.get(raw.tecnicoSgpId) : undefined,
        },
        update: {
          tipoOsId: raw.tipoCodigo ? tipoPorSgpCodigo.get(raw.tipoCodigo) : undefined,
          status: mapSgpOsStatus(raw.statusCode),
          prioridade: raw.prioridade ?? 2,
          clienteNome: raw.clienteNome,
          clienteDocumento: raw.clienteDocumento,
          contratoId: raw.contratoId,
          protocolo: raw.protocolo,
          conteudo: raw.conteudo,
          observacao: raw.observacao,
          logradouro: raw.endereco.logradouro,
          numero: raw.endereco.numero,
          bairro: raw.endereco.bairro,
          cidade: raw.endereco.cidade,
          lat: raw.endereco.lat,
          lng: raw.endereco.lng,
          dataAgendamento: raw.dataAgendamento ? new Date(raw.dataAgendamento) : null,
          tecnicoId: raw.tecnicoSgpId ? tecnicoPorSgpId.get(raw.tecnicoSgpId) : undefined,
          sincronizadoEm: new Date(),
        },
      });
    }
    await logSync(provedorId, "pull", "os", true, ordens.length, inicioOs);
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
      await prisma.ocorrencia.upsert({
        where: { provedorId_sgpNumero: { provedorId, sgpNumero: raw.sgpNumero } },
        create: {
          provedorId,
          sgpNumero: raw.sgpNumero,
          tipo: raw.tipo,
          status: raw.status,
          conteudo: raw.conteudo,
          responsavel: raw.responsavel,
          contratoId: raw.contratoId,
          dataCadastro: raw.dataCadastro ? new Date(raw.dataCadastro) : null,
          dataAgendamento: raw.dataAgendamento ? new Date(raw.dataAgendamento) : null,
        },
        update: {
          tipo: raw.tipo,
          status: raw.status,
          conteudo: raw.conteudo,
          responsavel: raw.responsavel,
          contratoId: raw.contratoId,
          dataCadastro: raw.dataCadastro ? new Date(raw.dataCadastro) : null,
          dataAgendamento: raw.dataAgendamento ? new Date(raw.dataAgendamento) : null,
          sincronizadoEm: new Date(),
        },
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
