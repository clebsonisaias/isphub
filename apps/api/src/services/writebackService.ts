import { OS_STATUS_LABEL, OsStatus, SgpOsStatus, UserRole, toSgpOsStatus, type OsEventoTipo } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { buildConnector } from "./erpConnectorService.js";

/**
 * Servico de write-back: toda acao do usuario sobre uma OS chama primeiro o
 * SGP do provedor dono da OS e, so em caso de sucesso, atualiza o espelho
 * local. Isso garante que o espelho nunca fique "adiantado" em relacao ao
 * que de fato aconteceu no ERP do provedor.
 *
 * Toda acao tambem grava um OsEvento (timeline) na mesma transacao da
 * atualizacao local — e o unico lugar que popula a timeline (ver
 * routes/ordensServico.ts GET /:id/eventos).
 */

function evento(ordemServicoId: string, tipo: OsEventoTipo, autorId: string, descricao: string) {
  return prisma.osEvento.create({ data: { ordemServicoId, tipo, autorId, descricao } });
}

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

export async function marcarACaminho(ordemServicoId: string, autorId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  await connector.setOnTheWay(os.sgpOsId);

  const [, osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { status: OsStatus.EM_DESLOCAMENTO, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
    }),
    evento(os.id, "status", autorId, "Marcado como a caminho"),
  ]);
  return osAtualizada;
}

export async function mudarStatus(ordemServicoId: string, novoStatus: OsStatus, autorId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);

  if (novoStatus === OsStatus.EM_DESLOCAMENTO) {
    // "A caminho" tem endpoint proprio no SGP; nao e um status generico.
    await connector.setOnTheWay(os.sgpOsId);
  } else {
    const codigo = toSgpOsStatus(novoStatus);
    if (codigo === undefined) {
      throw new HttpError(400, `Status "${novoStatus}" nao tem equivalente de escrita no SGP`);
    }
    // Ao encerrar (concluida/cancelada mapeiam pro mesmo "Encerrada" no SGP),
    // manda a data de finalizacao — sem isso o SGP fecha a OS sem registrar
    // quando de fato terminou.
    const dataFinalizacao = codigo === SgpOsStatus.ENCERRADA ? new Date().toISOString() : undefined;
    await connector.updateOsStatus(os.sgpOsId, codigo, dataFinalizacao);
  }

  const descricao = `Status alterado: ${OS_STATUS_LABEL[os.status as OsStatus]} → ${OS_STATUS_LABEL[novoStatus]}`;
  const [, osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { status: novoStatus, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
    }),
    evento(os.id, "status", autorId, descricao),
  ]);
  return osAtualizada;
}

export async function adicionarAnotacao(ordemServicoId: string, texto: string, autorId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  await connector.addOsNote(os.sgpOsId, texto);

  // Eco local best-effort: o SGP nao expoe endpoint de leitura de historico
  // completo de anotacoes de forma pratica para o espelho, entao guardamos
  // a ultima anotacao em `observacao` (referencia rapida na UI) e o texto
  // completo tambem vira um OsEvento (historico real, na aba Historico).
  const [, osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { observacao: texto, sincronizadoEm: new Date() },
    }),
    evento(os.id, "anotacao", autorId, texto),
  ]);
  return osAtualizada;
}

/**
 * Foto de evidencia — hospedada no proprio SGP (endpoints reais de imagem,
 * ver connectors/sgp.ts). A ISPhub nao guarda os bytes: so grava o evento na
 * timeline local e, pra listar/exibir, consulta o SGP ao vivo (mesmo padrao
 * de checkConnectionStatus/getDetalhesTecnicos).
 */
export async function adicionarEvidencia(
  ordemServicoId: string,
  imagemBase64: string,
  autorId: string,
  legenda?: string,
) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  await connector.addOsImage(os.sgpOsId, imagemBase64, legenda);
  await evento(os.id, "foto", autorId, legenda ? `Foto adicionada: ${legenda}` : "Foto adicionada");
  return connector.listOsImages(os.sgpOsId);
}

export async function listarEvidencias(ordemServicoId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  return connector.listOsImages(os.sgpOsId);
}

export async function obterArquivoEvidencia(ordemServicoId: string, anexoId: string) {
  const { connector } = await loadOsWithConnector(ordemServicoId);
  return connector.getOsImageFile(anexoId);
}

/**
 * Atribuicao de tecnico e local-only no MVP: o SGP nao documenta um endpoint
 * de escrita para "tecnico responsavel" separado da OS. Fica registrado no
 * ISPhub (Atribuicao + OrdemServico.tecnicoId) para fins de despacho e
 * dashboard; nao ha write-back ao SGP para este campo especifico.
 *
 * O tecnico e um Usuario com role=tecnico (pessoal da ISPhub, sem vinculo
 * com um provedor especifico) — por isso nao ha mais checagem cross-provedor
 * aqui, so a validacao de que o alvo e de fato um tecnico ativo.
 */
export async function atribuirTecnico(ordemServicoId: string, tecnicoId: string, autorId: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");

  const tecnico = await prisma.usuario.findUnique({ where: { id: tecnicoId } });
  if (!tecnico || tecnico.role !== UserRole.TECNICO) throw new HttpError(404, "Tecnico nao encontrado");
  if (!tecnico.ativo) throw new HttpError(409, "Tecnico esta inativo");

  const [, osAtualizada] = await prisma.$transaction([
    prisma.atribuicao.create({ data: { ordemServicoId, tecnicoId, atribuidoPor: autorId } }),
    prisma.ordemServico.update({ where: { id: ordemServicoId }, data: { tecnicoId } }),
    evento(ordemServicoId, "atribuicao", autorId, `Atribuído a ${tecnico.nome}`),
    prisma.notificacao.create({
      data: {
        usuarioId: tecnicoId,
        tipo: "atribuicao",
        mensagem: `Nova OS atribuída: ${os.clienteNome ?? `#${os.sgpOsId}`}`,
        ordemServicoId,
      },
    }),
  ]);

  return osAtualizada;
}
