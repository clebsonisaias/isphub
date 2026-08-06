import {
  MOTIVO_RECUSA_TEXTO,
  OS_STATUS_LABEL,
  OsStatus,
  STATUS_CONTRATO,
  SgpOsStatus,
  UserRole,
  rotuloDoTexto,
  toSgpOsStatus,
  transicaoPermitida,
  type CodigoStatusContrato,
  type OsEventoTipo,
  type OsFichaSgp,
  type RealtimeEventoTipo,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { buildConnector } from "./erpConnectorService.js";
import { SgpError } from "../connectors/sgp.js";
import { comConcorrenciaLimitada } from "../lib/limitador.js";
import { emitParaUsuario } from "./realtimeHub.js";
import { dispararPush } from "./pushService.js";

/** Empurra um evento realtime pro tecnico da OS (best-effort — SSE so reduz latencia). */
function notificarTecnico(tecnicoId: string | null, tipo: RealtimeEventoTipo, osId: string) {
  emitParaUsuario(tecnicoId, { tipo, osId, em: new Date().toISOString() });
}

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

/**
 * Erros do conector (rede, HTTP nao-2xx, ou recusa por regra de negocio no
 * corpo — ver connectors/sgp.ts assertSgpEscritaOk) sao Error simples, entao
 * o errorHandler central os mascara como 500 "Erro interno do servidor".
 * Aqui a mensagem em si e informacao de negocio segura de mostrar (ex.: "SGP
 * recusou a escrita em ...: motivo") — converte pra HttpError(502) pra
 * chegar de verdade no toast do usuario em vez de sumir.
 */
/**
 * Traduz a recusa crua do SGP em algo ACIONAVEL.
 *
 * "SGP 403 em /api/os/acaminho/id/5326/:" nao diz nada pra quem esta no
 * quintal do cliente — a pessoa nao sabe se tenta de novo, se liga pro
 * escritorio ou se o problema e o celular dela. Cada status vira uma frase que
 * responde exatamente isso.
 */
function mensagemAmigavelSgp(bruta: string): string {
  const status = /SGP (\d{3}) em/.exec(bruta)?.[1];
  switch (status) {
    case "401":
      return "O SGP recusou as credenciais da integração (token inválido ou expirado). Avise o escritório.";
    case "403":
      return "O SGP não autorizou esta operação para o token da integração. É permissão no SGP do provedor — avise o escritório.";
    case "404":
      return "O SGP não encontrou esta OS. Ela pode ter sido removida ou alterada por lá.";
    case "500":
    case "502":
    case "503":
      return "O SGP do provedor está fora do ar ou instável. Tente de novo em alguns minutos.";
    default:
      if (/timeout|abort/i.test(bruta)) return "O SGP não respondeu a tempo. Tente de novo em alguns instantes.";
      return bruta;
  }
}

async function chamarSgp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const bruta = err instanceof Error ? err.message : "Falha na comunicacao com o SGP";
    // Recusa do SGP nao deixava rastro nenhum: virava 502 e sumia. Sem log, a
    // unica evidencia era o print do celular do tecnico.
    console.error("[sgp-writeback] recusa do SGP:", bruta);

    // Quando o SGP explica a recusa (ex.: "É necessário haver ao menos 2
    // foto(s) para encerrar o chamado"), essa frase E a mensagem — ela ja diz
    // ao tecnico o que fazer. Enterra-la dentro de "SGP 422 em https://.../:
    // {...}" era transformar uma instrucao clara em ruido tecnico.
    //
    // 422 vira 409 (conflito de regra de negocio), nao 502: nada falhou na
    // comunicacao — o SGP entendeu e recusou por uma condicao que o tecnico
    // pode resolver.
    if (err instanceof SgpError && err.mensagemNegocio) {
      throw new HttpError(err.status === 422 ? 409 : 502, err.mensagemNegocio);
    }
    throw new HttpError(502, mensagemAmigavelSgp(bruta));
  }
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
  await chamarSgp(() => connector.setOnTheWay(os.sgpOsId));

  // A OS atualizada e o 1o elemento da transacao; o evento e o 2o (e nao tem
  // campo `status`) — pegar o indice errado devolvia o evento pro front, que
  // entao exibia o status vazio ate o dialog fechar e a fila re-buscar.
  const [osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { status: OsStatus.EM_DESLOCAMENTO, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
    }),
    evento(os.id, "status", autorId, "Marcado como a caminho"),
  ]);
  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
  return osAtualizada;
}

export async function mudarStatus(ordemServicoId: string, novoStatus: OsStatus, autorId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);

  if (novoStatus === OsStatus.EM_DESLOCAMENTO) {
    // "A caminho" tem endpoint proprio no SGP; nao e um status generico.
    await chamarSgp(() => connector.setOnTheWay(os.sgpOsId));
  } else {
    const codigo = toSgpOsStatus(novoStatus);
    if (codigo === undefined) {
      throw new HttpError(400, `Status "${novoStatus}" nao tem equivalente de escrita no SGP`);
    }
    // So o status. Concluida e cancelada mapeiam pro mesmo "Encerrada" (1) do
    // SGP — a distincao entre as duas vive no espelho local, que e o unico
    // lugar capaz de representa-la (ver reconciliarStatus no syncService).
    await chamarSgp(() => connector.updateOsStatus(os.sgpOsId, codigo));
  }

  const descricao = `Status alterado: ${OS_STATUS_LABEL[os.status as OsStatus]} → ${OS_STATUS_LABEL[novoStatus]}`;
  // Pega a OS atualizada (1o elemento), nao o evento (2o) — ver marcarACaminho.
  const [osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { status: novoStatus, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
    }),
    evento(os.id, "status", autorId, descricao),
  ]);
  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
  return osAtualizada;
}


/**
 * Muda o status do CONTRATO no SGP, a partir de uma OS.
 *
 * TRES coisas acontecem aqui, nesta ordem, e a ordem importa:
 *
 * 1. VALIDA papel + transicao ANTES de qualquer chamada. Cancelar um contrato
 *    derruba o servico de um cliente real — a recusa tem que vir antes da
 *    escrita, nao depois. A regra vive em packages/shared (`transicaoPermitida`)
 *    porque a TELA precisa da MESMA resposta pra decidir o que oferecer; duas
 *    copias divergiriam e a tela ofereceria o que a API recusa.
 *
 * 2. ESCREVE no SGP. Falhou, nada muda no espelho — o contrario deixaria o
 *    ISPhub afirmando um status que o ERP nao tem.
 *
 * 3. GRAVA espelho + trilha na MESMA transacao. A implementacao de referencia
 *    registra em comentario um incidente por "mudancas via URA sem rastro":
 *    aqui o evento nasce junto, nao como refinamento.
 */
export async function alterarStatusContrato(
  ordemServicoId: string,
  alvo: CodigoStatusContrato,
  autorId: string,
  role: UserRole,
) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);

  if (!os.contratoId) {
    throw new HttpError(409, "Esta OS nao tem contrato vinculado no SGP");
  }

  const veredito = transicaoPermitida(role, os.contratoStatus, alvo);
  if (!veredito.permitido) {
    /*
     * 403, nao 400: o pedido esta bem formado e o alvo e valido — o que nao
     * alcanca e o papel de quem pediu (ou o estado de onde parte). 400 diria
     * "voce escreveu errado", mandando a pessoa corrigir o que esta certo.
     */
    throw new HttpError(403, MOTIVO_RECUSA_TEXTO[veredito.motivo]);
  }

  const de = rotuloDoTexto(os.contratoStatus);
  const para = STATUS_CONTRATO[alvo];

  await chamarSgp(() => connector.alterarStatusContrato(os.contratoId!, alvo));

  const [osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: {
        /*
         * Grava o ROTULO canonico, nao o texto cru: o proximo sync traz o texto
         * real do SGP e sobrescreve este. Ate la, a tela mostra o que a pessoa
         * acabou de escolher em vez do valor antigo — e `contratoStatusAlteradoEm`
         * segura o sync por 5 min, porque o SGP aceita a escrita mas a leitura
         * seguinte ainda devolve o antigo por alguns ciclos.
         */
        contratoStatus: para,
        contratoStatusAlteradoEm: new Date(),
      },
    }),
    evento(os.id, "contrato", autorId, `Contrato ${os.contratoId}: ${de} → ${para}`),
  ]);

  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
  return osAtualizada;
}

/**
 * Ficha completa da OS lida ao vivo do SGP — o que o espelho local nao tem
 * (plano, credenciais PPPoE, ponto de referencia).
 *
 * Cache de 90s por OS e teto de concorrencia por PROVEDOR, igual ao
 * /conexao/detalhes: a tela do tecnico chama isto ao abrir cada OS, e sem os
 * dois uma fila sendo percorrida vira uma rajada no SGP do provedor.
 *
 * Falha do SGP nao derruba a tela: devolve null e o app segue mostrando o
 * espelho local, que e o que importa pra trabalhar.
 */
const FICHA_CACHE_TTL_MS = 90_000;
const FICHA_MAX_CONCORRENTE_POR_PROVEDOR = 4;
const fichaCache = new Map<string, { valor: OsFichaSgp | null; expiraEm: number }>();

export async function obterFichaSgp(ordemServicoId: string): Promise<OsFichaSgp | null> {
  const emCache = fichaCache.get(ordemServicoId);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.valor;

  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  let valor: OsFichaSgp | null = null;
  try {
    valor = await comConcorrenciaLimitada(os.provedorId, FICHA_MAX_CONCORRENTE_POR_PROVEDOR, () =>
      // O contrato vem do espelho: e o que destrava o cadastro do assinante no
      // SGP, de onde sai o PPPoE real (ver obterFichaOs no connector).
      connector.obterFichaOs(os.sgpOsId, os.contratoId),
    );
  } catch (err) {
    // Best-effort de proposito: a ficha ENRIQUECE a tela, nao a sustenta.
    console.error("[sgp-ficha] falha ao ler a ficha da OS:", err instanceof Error ? err.message : err);
  }
  fichaCache.set(ordemServicoId, { valor, expiraEm: Date.now() + FICHA_CACHE_TTL_MS });
  return valor;
}

export async function adicionarAnotacao(ordemServicoId: string, texto: string, autorId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  await chamarSgp(() => connector.addOsNote(os.sgpOsId, texto));

  // Eco local best-effort: o SGP nao expoe endpoint de leitura de historico
  // completo de anotacoes de forma pratica para o espelho, entao guardamos
  // a ultima anotacao em `observacao` (referencia rapida na UI) e o texto
  // completo tambem vira um OsEvento (historico real, na aba Historico).
  // observacaoAlteradaEm protege esse eco contra o sync sobrescrever com um
  // valor desatualizado antes do SGP confirmar (mesma logica do status).
  // Pega a OS atualizada (1o elemento), nao o evento (2o) — ver marcarACaminho.
  const [osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { observacao: texto, sincronizadoEm: new Date(), observacaoAlteradaEm: new Date() },
    }),
    evento(os.id, "anotacao", autorId, texto),
  ]);
  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
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
  await chamarSgp(() => connector.addOsImage(os.sgpOsId, imagemBase64, legenda));
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

  // Reconcilia a thread de chat da OS, se existir. A lista de participantes era
  // congelada na criacao (o upsert de garantirConversaDeOs usa `update: {}`),
  // entao numa reatribuicao o tecnico ANTERIOR continuava dentro da conversa —
  // lendo mensagens, fotos e GPS sobre o cliente de uma OS que nao e mais dele
  // — e o tecnico NOVO nunca entrava, levando 403 na conversa da propria OS.
  const conversa = await prisma.conversa.findUnique({ where: { ordemServicoId }, select: { id: true } });
  if (conversa) {
    const anteriorId = os.tecnicoId;
    await prisma.$transaction([
      prisma.conversaParticipante.upsert({
        where: { conversaId_usuarioId: { conversaId: conversa.id, usuarioId: tecnicoId } },
        update: { saiuEm: null },
        create: { conversaId: conversa.id, usuarioId: tecnicoId },
      }),
      // Sai da conversa, mas o historico fica (soft): o que foi dito na OS e
      // registro operacional, nao some porque a OS trocou de mao.
      ...(anteriorId && anteriorId !== tecnicoId
        ? [
            prisma.conversaParticipante.updateMany({
              where: { conversaId: conversa.id, usuarioId: anteriorId, saiuEm: null },
              data: { saiuEm: new Date() },
            }),
          ]
        : []),
    ]);
  }

  // Nova OS pro tecnico: empurra pra lista dele aparecer na hora + badge.
  notificarTecnico(tecnicoId, "os-atribuida", ordemServicoId);
  // ...e toca o celular dele, que e o unico canal que funciona com o app
  // fechado — despacho que so aparece quando o tecnico resolve abrir o app nao
  // e despacho. Nao avisa quem se auto-atribuiu.
  if (tecnicoId !== autorId) {
    // Onde e pra quando: e o que decide se ele muda a rota agora ou depois.
    const onde = os.bairro ?? os.cidade ?? os.pop;
    dispararPush([tecnicoId], {
      titulo: "Nova OS pra você",
      corpo: [os.clienteNome ?? `OS #${os.sgpOsId}`, onde].filter(Boolean).join(" — "),
      dados: { tela: "os", osId: ordemServicoId },
    });
  }
  return osAtualizada;
}
