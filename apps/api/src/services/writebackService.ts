import { OsStatus, toSgpOsStatus } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { buildConnector } from "./erpConnectorService.js";

/**
 * Servico de write-back: toda acao do usuario sobre uma OS chama primeiro o
 * SGP do provedor dono da OS e, so em caso de sucesso, atualiza o espelho
 * local. Isso garante que o espelho nunca fique "adiantado" em relacao ao
 * que de fato aconteceu no ERP do provedor.
 */

async function loadOsWithConnector(ordemServicoId: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");

  const config = await prisma.erpConfig.findFirst({
    where: { provedorId: os.provedorId, tipo: "SGP", ativo: true },
  });
  if (!config) throw new HttpError(409, "Integracao SGP nao configurada/ativa para o provedor desta OS");

  const connector = buildConnector(config);
  return { os, connector };
}

export async function marcarACaminho(ordemServicoId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  await connector.setOnTheWay(os.sgpOsId);
  return prisma.ordemServico.update({
    where: { id: os.id },
    data: { status: OsStatus.EM_DESLOCAMENTO, sincronizadoEm: new Date() },
  });
}

export async function mudarStatus(ordemServicoId: string, novoStatus: OsStatus) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);

  if (novoStatus === OsStatus.EM_DESLOCAMENTO) {
    // "A caminho" tem endpoint proprio no SGP; nao e um status generico.
    await connector.setOnTheWay(os.sgpOsId);
  } else {
    const codigo = toSgpOsStatus(novoStatus);
    if (codigo === undefined) {
      throw new HttpError(400, `Status "${novoStatus}" nao tem equivalente de escrita no SGP`);
    }
    await connector.updateOsStatus(os.sgpOsId, codigo);
  }

  return prisma.ordemServico.update({
    where: { id: os.id },
    data: { status: novoStatus, sincronizadoEm: new Date() },
  });
}

export async function adicionarAnotacao(ordemServicoId: string, texto: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  await connector.addOsNote(os.sgpOsId, texto);
  // Eco local best-effort: o SGP nao expoe endpoint de leitura de historico
  // completo de anotacoes de forma pratica para o espelho, entao guardamos
  // apenas a ultima anotacao em `observacao` como referencia rapida na UI.
  return prisma.ordemServico.update({
    where: { id: os.id },
    data: { observacao: texto, sincronizadoEm: new Date() },
  });
}

/**
 * Atribuicao de tecnico e local-only no MVP: o SGP nao documenta um endpoint
 * de escrita para "tecnico responsavel" separado da OS. Fica registrado no
 * ISPhub (Atribuicao + OrdemServico.tecnicoId) para fins de despacho e
 * dashboard; nao ha write-back ao SGP para este campo especifico.
 */
export async function atribuirTecnico(ordemServicoId: string, tecnicoId: string, atribuidoPor?: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");

  const tecnico = await prisma.tecnico.findUnique({ where: { id: tecnicoId } });
  if (!tecnico) throw new HttpError(404, "Tecnico nao encontrado");
  if (tecnico.provedorId && tecnico.provedorId !== os.provedorId) {
    throw new HttpError(409, "Tecnico pertence a outro provedor");
  }

  await prisma.atribuicao.create({
    data: { ordemServicoId, tecnicoId, atribuidoPor },
  });

  return prisma.ordemServico.update({
    where: { id: ordemServicoId },
    data: { tecnicoId },
  });
}
