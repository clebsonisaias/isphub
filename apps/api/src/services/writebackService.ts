import {
  MOTIVO_RECUSA_TEXTO,
  OS_STATUS_ABERTOS,
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
import { parGeo, type Geo } from "../lib/geo.js";
import { HttpError } from "../middleware/errorHandler.js";
import { buildConnector } from "./erpConnectorService.js";
import { SgpError } from "../connectors/sgp.js";
import { comConcorrenciaLimitada } from "../lib/limitador.js";
import { emitParaTodos, emitParaUsuario } from "./realtimeHub.js";
import { dispararPush } from "./pushService.js";
import { avisarClienteACaminho, encerrarConversasDeOsConcluidas } from "./clienteAtendaiService.js";

/** Empurra um evento realtime pro tecnico da OS (best-effort — SSE so reduz latencia). */
function notificarTecnico(tecnicoId: string | null, tipo: RealtimeEventoTipo, osId: string) {
  emitParaUsuario(tecnicoId, { tipo, osId, em: new Date().toISOString() });
}

/**
 * OS PENDENTE (pedido de 05/11/2026): geralmente a instalacao foi tentada varias
 * vezes sem retorno do cliente. Ela vai pra aba Pendentes e sai do despacho —
 * sem tecnico nem apoio no ISPhub. So aqui: o SGP continua com o tecnico
 * designado, e quando a OS volta a andar o espelho do despacho o traz de volta.
 */
export const DESVINCULO_PENDENTE = "Pendente: técnico desvinculado automaticamente";
const SEM_TECNICO = { tecnicoId: null, apoios: { set: [] } };

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

/**
 * A transicao de status, ESTRUTURADA — o par que acompanha a frase.
 *
 * `de` e opcional porque nem toda transicao conhece a origem: "Marcado como a
 * caminho" nunca a registrou. Nulo la quer dizer "nao sabemos", e nao "veio de
 * aberta" — e a diferenca importa pro BI, que conta transicoes.
 */
interface Transicao {
  de?: OsStatus;
  para: OsStatus;
}

function evento(
  ordemServicoId: string,
  tipo: OsEventoTipo,
  /** Nulo = acao do sistema (robo da planilha), sem usuario por tras. */
  autorId: string | null,
  descricao: string,
  geo?: Geo,
  transicao?: Transicao,
) {
  // A coordenada entra no EVENTO (nao na OS) porque o que interessa e o rastro:
  // de onde ele disse que saiu, de onde disse que chegou, de onde terminou. Na
  // OS so caberia a ultima.
  //
  // `statusDe`/`statusPara` acompanham a descricao em vez de substitui-la: a
  // frase e o que a timeline mostra ao tecnico, e as colunas sao o que o BI
  // consulta. Derivar uma da outra na leitura era o que fazia "quantas OS
  // fecharam hoje" depender de casar string em portugues.
  return prisma.osEvento.create({
    data: {
      ordemServicoId,
      tipo,
      autorId,
      descricao,
      ...parGeo(geo),
      statusDe: transicao?.de ?? null,
      statusPara: transicao?.para ?? null,
    },
  });
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

export async function marcarACaminho(ordemServicoId: string, autorId: string, geo?: Geo) {
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
    evento(os.id, "status", autorId, "Marcado como a caminho", geo, {
      // A origem E conhecida aqui — e o status que a OS tinha ate esta linha.
      de: os.status as OsStatus,
      para: OsStatus.EM_DESLOCAMENTO,
    }),
  ]);
  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
  // Notifica o cliente automaticamente pelo WhatsApp oficial da NetGO com cálculo dinâmico de trânsito (TomTom)
  void avisarClienteACaminho(os.id, autorId, geo).catch(() => {});
  return osAtualizada;
}

export async function mudarStatus(
  ordemServicoId: string,
  novoStatus: OsStatus,
  autorId: string,
  geo?: Geo,
) {
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

  // OS PENDENTE nao tem tecnico no ISPhub: titular e apoios saem na mesma
  // transacao do status (o SGP continua com o tecnico designado).
  const apoioIds =
    novoStatus === OsStatus.PENDENTE
      ? ((await prisma.ordemServico.findUnique({ where: { id: os.id }, select: { apoios: { select: { id: true } } } }))?.apoios ?? []).map((a) => a.id)
      : [];
  const desvincula = novoStatus === OsStatus.PENDENTE && (!!os.tecnicoId || apoioIds.length > 0);

  const descricao = `Status alterado: ${OS_STATUS_LABEL[os.status as OsStatus]} → ${OS_STATUS_LABEL[novoStatus]}`;
  // Pega a OS atualizada (1o elemento), nao o evento (2o) — ver marcarACaminho.
  const [osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { status: novoStatus, sincronizadoEm: new Date(), statusAlteradoEm: new Date(), ...(desvincula ? SEM_TECNICO : {}) },
    }),
    evento(os.id, "status", autorId, descricao, geo, { de: os.status as OsStatus, para: novoStatus }),
    ...(desvincula ? [evento(os.id, "atribuicao", autorId, DESVINCULO_PENDENTE)] : []),
  ]);
  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
  // Quem estava na OS perde ela: a lista dele refaz na hora.
  if (desvincula) for (const u of [os.tecnicoId, ...apoioIds]) notificarTecnico(u, "os-removida", os.id);
  // Painel e Despacho das outras telas recarregam na hora (antes so o tecnico sabia).
  emitParaTodos({ tipo: "os-alterada", em: new Date().toISOString() });
  // OS concluida: a conversa com o cliente aberta por ela encerra e a CláudIA
  // volta. Sem esperar — concluir nao pode ficar refem do AtendAI.
  if (novoStatus === OsStatus.CONCLUIDA) void encerrarConversasDeOsConcluidas({ ordemServicoId: os.id }).catch(() => {});
  return osAtualizada;
}

/** O que fica escrito no SGP: quem encerrou e por quê (o SGP só mostra o usuário da integração). */
export const notaDeEncerramento = (nome: string, motivo: string) => `Encerrada pelo ISPhub por ${nome}, sem visita. Motivo: ${motivo}`;

/**
 * Encerra a OS sem visita (a internet voltou, o cliente desistiu...), pela tela
 * de marcar. No SGP: anotação com quem e por quê, depois status Encerrada — a
 * anotação vai antes para o motivo nunca faltar lá (se o status falhar, tentar
 * de novo só repete a anotação). No ISPhub vira CANCELADA, não concluída: não
 * conta como serviço feito, e o sync mantém cancelada mesmo com o SGP dizendo
 * "encerrada". A visita marcada sai da agenda e libera a vaga.
 */
export async function encerrarSemVisita(ordemServicoId: string, motivo: string, autorId: string) {
  const { os, connector } = await loadOsWithConnector(ordemServicoId);
  if (!OS_STATUS_ABERTOS.includes(os.status as OsStatus)) throw new HttpError(409, "Esta OS já está encerrada");
  const autor = await prisma.usuario.findUnique({ where: { id: autorId }, select: { nome: true } });

  await chamarSgp(() => connector.addOsNote(os.sgpOsId, notaDeEncerramento(autor?.nome ?? "usuário do ISPhub", motivo)));
  await chamarSgp(() => connector.updateOsStatus(os.sgpOsId, SgpOsStatus.ENCERRADA));

  const [osAtualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id: os.id },
      data: { status: OsStatus.CANCELADA, sincronizadoEm: new Date(), statusAlteradoEm: new Date() },
    }),
    evento(os.id, "status", autorId, `Encerrada sem visita. Motivo: ${motivo}`, undefined, {
      de: os.status as OsStatus,
      para: OsStatus.CANCELADA,
    }),
    prisma.agendamento.updateMany({
      where: { provedorId: os.provedorId, sgpOsId: os.sgpOsId, status: "marcado" },
      data: { status: "cancelado", ordemRota: null },
    }),
  ]);
  notificarTecnico(osAtualizada.tecnicoId, "os-alterada", os.id);
  emitParaTodos({ tipo: "os-alterada", em: new Date().toISOString() });
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
/**
 * `autorId` nulo = atribuicao do sistema (robo da planilha): o evento fica sem
 * autor e `atribuidoPor` registra de onde veio (ex.: "planilha") — e o que o
 * robo usa pra saber que pode trocar o tecnico depois.
 */
/** Quando o tecnico veio de uma fonte automatica, o historico diz qual. */
const ORIGEM_NO_EVENTO: Record<string, string> = { sgp: " (pelo SGP)", planilha: " (pela planilha)" };

export async function atribuirTecnico(
  ordemServicoId: string,
  tecnicoId: string,
  autorId: string | null,
  atribuidoPor: string | null = autorId,
) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");
  // Pendente nao tem tecnico (ver DESVINCULO_PENDENTE): o proximo sync tiraria
  // de novo. Retomar e mudar o status; ai sim se designa.
  if (os.status === OsStatus.PENDENTE) throw new HttpError(409, "OS pendente: mude o status antes de designar um técnico");

  const tecnico = await prisma.usuario.findUnique({ where: { id: tecnicoId } });
  if (!tecnico || tecnico.role !== UserRole.TECNICO) throw new HttpError(404, "Tecnico nao encontrado");
  if (!tecnico.ativo) throw new HttpError(409, "Tecnico esta inativo");

  const [, osAtualizada] = await prisma.$transaction([
    prisma.atribuicao.create({ data: { ordemServicoId, tecnicoId, atribuidoPor } }),
    prisma.ordemServico.update({ where: { id: ordemServicoId }, data: { tecnicoId } }),
    evento(ordemServicoId, "atribuicao", autorId, `Atribuído a ${tecnico.nome}${ORIGEM_NO_EVENTO[atribuidoPor ?? ""] ?? ""}`),
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

/**
 * Passo do sync: toda OS PENDENTE do provedor que ainda tem tecnico ou apoio no
 * ISPhub perde os dois (ver DESVINCULO_PENDENTE). Cobre a que virou pendente no
 * SGP e as que ja estavam pendentes com tecnico antes desta regra existir.
 * Um evento por OS, sem autor (foi o sistema); quem perdeu a OS e avisado.
 */
export async function desvincularPendentes(provedorId: string): Promise<number> {
  const oss = await prisma.ordemServico.findMany({
    where: { provedorId, status: OsStatus.PENDENTE, OR: [{ tecnicoId: { not: null } }, { apoios: { some: {} } }] },
    select: { id: true, tecnicoId: true, apoios: { select: { id: true } } },
  });
  for (const os of oss) {
    await prisma.$transaction([
      prisma.ordemServico.update({ where: { id: os.id }, data: SEM_TECNICO }),
      evento(os.id, "atribuicao", null, DESVINCULO_PENDENTE),
    ]);
    for (const u of [os.tecnicoId, ...os.apoios.map((a) => a.id)]) notificarTecnico(u, "os-removida", os.id);
  }
  // Um aviso so pras telas de quem despacha, como o resto do sync.
  if (oss.length > 0) emitParaTodos({ tipo: "os-alterada", em: new Date().toISOString() });
  return oss.length;
}
