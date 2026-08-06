import type { Endereco } from "./types.js";

/** Credenciais de acesso ao ERP de um provedor. */
export interface ErpCredentials {
  url: string;
  app: string;
  token: string;
}

/** Tipo de OS bruto vindo do ERP (ja normalizado pelo adapter). */
export interface RawOsType {
  sgpCodigo: string;
  descricao: string;
}

/** Ordem de servico normalizada pelo adapter (formato neutro de ERP). */
export interface RawOs {
  sgpOsId: string;
  tipoCodigo?: string | null;
  tipoDescricao?: string | null;
  /** Codigo numerico de status no ERP (mapeado depois por mapSgpOsStatus). */
  /**
   * Status cru do ERP. Pode vir como codigo numerico (`status_id`: 0/1/2/3)
   * ou como rotulo textual (`status`: "Aberta"/"Encerrada"/...) — instancias
   * reais do SGP mandam os dois. Quem interpreta e mapSgpOsStatus.
   */
  statusCode: number | string;
  prioridade?: number | null;
  clienteNome?: string | null;
  clienteDocumento?: string | null;
  contratoId?: string | null;
  contratoStatus?: string | null;
  protocolo?: string | null;
  conteudo?: string | null;
  observacao?: string | null;
  endereco: Endereco;
  pop?: string | null;
  usuario?: string | null;
  dataCadastro?: string | null;
  dataAgendamento?: string | null;
  /** Nome do tecnico designado no SGP (pessoal do provedor) — so informativo. */
  tecnicoSgpNome?: string | null;
}

export interface ListOsParams {
  status?: number;
  motivo?: number[];
  contrato?: number;
  offset?: number;
  limit?: number;
}

/**
 * Resultado de uma varredura de listagem. `completo` e o que separa "o
 * espelho pode confiar nesta lista pra saber o que SUMIU" de "so sei o que
 * veio, nao o que faltou" — sem isso, uma falha de rede no meio da paginacao
 * pareceria "a OS sumiu" e a reconciliacao de status cancelaria OS viva em
 * massa (ver a trava em syncService.ts).
 */
export interface ListagemOs {
  itens: RawOs[];
  /** `paginacao.total` que o SGP anunciou, quando informado. */
  total: number | null;
  /** `false` se bateu no teto de paginas ou algo interrompeu a coleta. */
  completo: boolean;
}

/** Status de conexao consultado ao vivo no ERP (nao faz parte do sync em massa). */
export interface ConnectionStatus {
  /** null = indeterminado (ERP nao respondeu com um sinal claro de online/offline). */
  online: boolean | null;
  /** Mensagem original do ERP (ex.: "Serviço Offline"), mostrada ao usuario. */
  mensagem: string | null;
}

/**
 * Detalhes tecnicos consultados ao vivo no ERP (endereco completo + sinal
 * da ONU + status de conexao) — nao fazem parte do sync em massa porque o
 * SGP nao expoe endereco de rua nem sinal nas listagens de OS,
 * so num endpoint de consulta de cliente separado.
 */
/**
 * Cadastro do cliente puxado sob demanda pro backfill (endereco de rua + geo +
 * telefone) — dados que a listagem de OS do SGP nao traz. Todos os campos
 * podem ser null quando o cliente existe mas nao tem aquele dado cadastrado.
 */
export interface ContratoCadastro {
  lat: number | null;
  lng: number | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  telefone: string | null;
}

export interface DetalhesTecnicos {
  endereco: Endereco | null;
  online: boolean | null;
  /** Potencia optica recebida pela ONU, em dBm (valores normais: -8 a -27; abaixo disso indica problema no sinal). */
  sinalRxDbm: number | null;
  /** Potencia optica transmitida pela ONU, em dBm. */
  sinalTxDbm: number | null;
  oltNome: string | null;
  mensagem: string | null;
}

/**
 * Ficha completa da OS lida AO VIVO do SGP (`/api/os/list/id/{id}/`).
 *
 * Complementa o espelho local em vez de substitui-lo: o espelho abre a tela na
 * hora (e funciona offline), isto chega depois e enriquece — mesmo desenho do
 * DetalhesTecnicos.
 *
 * O recorte e do que muda o trabalho de quem esta na porta do cliente. Ficam
 * FORA os `*_id` internos, os flags de regra do SGP
 * (`os_close_edit`, `os_encerrada_impedir_*`, `os_lancamento_comodato`) e o
 * `os_djson`: nada disso ajuda o tecnico e cada campo a mais e uma linha a
 * mais pra ele varrer no sol.
 */
export interface OsFichaSgp {
  /**
   * Dados do assinante, pra confirmar na porta que e a pessoa certa. `documento`
   * e o desempate quando o nome do cadastro nao e quem atende.
   */
  clienteNome: string | null;
  clienteDocumento: string | null;
  clienteEmail: string | null;
  /** Status do contrato como o SGP mostra (ex.: "Ativo", "Suspenso"). */
  contratoStatus: string | null;

  /** Plano contratado — o tecnico precisa saber a velocidade que DEVERIA entregar. */
  plano: string | null;
  planoDownload: string | null;
  planoUpload: string | null;

  /**
   * Credenciais PPPoE do servico. E o dado que mais economiza ligacao pro
   * escritorio: sem isto o tecnico nao configura a ONU sozinho.
   * `servicoSenha` e SEGREDO — nunca logada, e o app mostra mascarada.
   */
  servicoLogin: string | null;
  servicoSenha: string | null;

  /** Conexao no momento da consulta (complementa o /verificaacesso). */
  servicoOnline: boolean | null;
  servicoIp: string | null;
  /** MAC visto na sessao ativa — confirma que se esta olhando o equipamento certo. */
  servicoMac: string | null;

  /** Como achar a casa: complemento e ponto de referencia nao existem no espelho. */
  enderecoComplemento: string | null;
  enderecoPontoReferencia: string | null;

  /** O que ja foi registrado na OS pelo escritorio ou por quem passou antes. */
  servicoPrestado: string | null;
  observacao: string | null;

  /** Com quem ele divide a OS, e o setor dono dela. */
  tecnicoResponsavel: string | null;
  tecnicosAuxiliares: string[];
  setor: string | null;

  /** Contato do cliente como o SGP tem (pode trazer mais de um numero). */
  clienteContato: string | null;

  /** Sinal optico da ONU, quando o contrato tem FTTX. */
  sinalRxDbm: number | null;
  sinalTxDbm: number | null;
  oltNome: string | null;
}

/**
 * Foto anexada a uma OS no SGP (evidencia de execucao). Hospedada no proprio
 * SGP — a ISPhub nao guarda os bytes, so consulta ao vivo (mesmo padrao de
 * checkConnectionStatus/getDetalhesTecnicos).
 */
export interface SgpImagem {
  id: string;
  descricao: string | null;
  usuario: string | null;
  arquivo: string | null;
}

export interface SgpImagemArquivo {
  contentType: string;
  bytes: Uint8Array;
}

/**
 * OLT (equipamento FTTX) do provedor. O provisionamento comeca escolhendo a
 * OLT — cada provedor tem o seu SGP, com as suas proprias OLTs.
 */
export interface Olt {
  id: string;
  nome: string;
  fabricante: string | null;
}

/**
 * ONU ainda NAO autorizada numa OLT: aparece quando o equipamento e ligado na
 * rede mas ainda nao foi provisionado. `id` e o identificador que o SGP usa pra
 * autorizar; `serial` (phy_addr) e o numero de serie fisico do aparelho.
 */
export interface OnuNaoAutorizada {
  id: string;
  serial: string;
  slot: string | null;
  pon: string | null;
  /** onutype sugerido pelo SGP (modelo do equipamento). */
  tipo: string | null;
  vlan: number | null;
  /** Potencia optica recebida, em dBm (faixa normal: -8 a -27). */
  sinalRxDbm: number | null;
}

/** ONU ja autorizada/provisionada numa OLT (com cliente/contrato vinculado). */
export interface OnuAutorizada {
  id: string;
  serial: string;
  slot: string | null;
  pon: string | null;
  contrato: string | null;
  clienteNome: string | null;
  sinalRxDbm: number | null;
  online: boolean | null;
}

/** Perfil/template de ONU do SGP — provisiona com vlan/onutype pre-definidos. */
export interface OnuTemplate {
  id: string;
  nome: string;
}

/**
 * Dados para autorizar (provisionar) uma ONU numa OLT — espelha os campos do
 * endpoint FTTX de autorizacao do SGP. `mode`: 1=bridge, 2=pppoe.
 */
export interface ProvisionarOnuInput {
  slot: string;
  pon: string;
  /** Serial/phy_addr (SN) da ONU — o SGP chama de `id` no corpo do auth. */
  serial: string;
  /** Modelo da ONU. OPCIONAL: quando omitido, o SGP detecta pelo SN (autofind). */
  onutype?: string;
  mode: 1 | 2;
  vlan?: number | null;
  /** Contrato do cliente (associa a ONU ao contrato). */
  contrato?: string | null;
  /** Servico/login do cliente (associacao alternativa ao contrato). */
  service?: string | null;
  pppoeLogin?: string | null;
  /** SEGREDO — nunca logar (ver redigirSegredosFttx em sgp.ts). */
  pppoeSenha?: string | null;
  onutemplate?: string | null;
  descricao?: string | null;
  /** Identificacao fisica (CTO/caixa). */
  ident?: string | null;
}

export interface ProvisionarOnuResultado {
  ok: boolean;
  mensagem: string | null;
  onuId?: string | null;
}

/**
 * Contrato de integracao com um ERP. Cada ERP (SGP, e futuros) implementa esta
 * interface; o nucleo do ISPhub (sync + write-back) so conhece este contrato,
 * nunca os detalhes de cada API.
 */
export interface ErpConnector {
  /** Valida credenciais fazendo uma chamada leve. */
  testConnection(): Promise<{ ok: boolean; message?: string }>;

  /** Catalogo de tipos de OS do provedor. */
  listOsTypes(): Promise<RawOsType[]>;

  /** Lista OS para o espelho (polling). Ver `ListagemOs` sobre `completo`. */
  listServiceOrders(params?: ListOsParams): Promise<ListagemOs>;

  // ---- write-back ----

  /** Marca a OS como "a caminho" (tecnico em deslocamento). */
  setOnTheWay(sgpOsId: string): Promise<void>;

  /**
   * Atualiza o status da OS no ERP (codigo numerico do ERP) — e SO o status.
   *
   * Todo o resto que o endpoint aceita (servico prestado, observacao, checkin,
   * assinaturas, classificacoes, datas) e opcional e nao entra aqui: mudar
   * status no ISPhub nao pede nada a quem clica. O proprio ERP estampa as
   * datas de alteracao/finalizacao.
   */
  updateOsStatus(sgpOsId: string, statusCode: number): Promise<void>;

  /**
   * Ficha completa da OS no ERP. Complementa o espelho local (que abre a tela
   * na hora); isto chega depois com o que o espelho nao tem — plano,
   * credenciais PPPoE, ponto de referencia. `null` quando o ERP nao devolve a
   * OS (removida por la, id divergente).
   */
  obterFichaOs(sgpOsId: string, contratoId?: string | null): Promise<OsFichaSgp | null>;

  /**
   * Qual o status da OS AGORA no SGP? Pergunta ESTRITA, separada de
   * `obterFichaOs` de proposito — as duas respondem coisas diferentes e nao
   * podem compartilhar politica de erro:
   *
   *  - `obterFichaOs` responde "o que consigo mostrar?" e e TOLERANTE: engole
   *    falha de uma fonte pra entregar a outra.
   *  - esta responde "o espelho ainda pode confiar no status que tem?" e NAO
   *    engole nada: erro de transporte PROPAGA, porque o unico `null` aceitavel
   *    e o de uma resposta bem-sucedida e vazia (a OS nao existe mais). Tratar
   *    timeout como ausencia cancelaria OS viva em massa numa instabilidade do
   *    ERP (ver a reconciliacao de status no sync).
   *
   * Era `osExisteNoSgp(): boolean` — respondia "existe?" quando a pergunta
   * certa e "ainda esta aberta?". Uma OS fechada EXISTE (o SGP a devolve),
   * entao o booleano dizia "sim" e a OS fechada nunca saia da fila de abertas
   * do ISPhub. O status cru resolve os dois casos que importam: `null` (nao
   * existe mais → cancelada aqui) e um codigo (usa `mapSgpOsStatus` pra saber
   * se ainda esta aberta ou se fechou).
   */
  obterStatusOs(sgpOsId: string): Promise<number | string | null>;

  /**
   * Muda o status do CONTRATO no ERP (nao o da OS).
   *
   * `status` e o codigo do REST (1..7 — ver STATUS_CONTRATO em
   * contratoStatus.ts), que NAO e o mesmo conjunto da coluna do banco do SGP:
   * no REST 3=Cancelado, na coluna 5=Cancelado. Mandar o numero errado muda o
   * contrato pro status errado sem devolver erro nenhum.
   */
  alterarStatusContrato(contratoId: string, status: number): Promise<void>;

  /**
   * Adiciona uma anotacao/andamento na OS.
   *
   * Nao existe contraparte de EDICAO da descricao (`conteudo`) da OS: a API do
   * SGP so expoe acrescentar anotacao. Confirmado ao vivo em producao — o
   * endpoint de update aceita `os_conteudo` com HTTP 200 e nenhum erro, mas
   * ignora o campo silenciosamente (a leitura seguinte devolve o texto
   * antigo). Por isso a descricao e somente-leitura no ISPhub.
   */
  addOsNote(sgpOsId: string, texto: string): Promise<void>;

  // ---- consultas ao vivo (sob demanda, fora do sync em massa) ----

  /** Verifica se o servico do contrato esta online/offline agora. */
  checkConnectionStatus(contratoId: string): Promise<ConnectionStatus>;

  /** Endereco completo + sinal da ONU + conexao do contrato, direto do cadastro do cliente. */
  getDetalhesTecnicos(contratoId: string): Promise<DetalhesTecnicos>;

  /**
   * Cadastro do cliente pro backfill em massa (endereco de rua + geo +
   * telefone) — a listagem de OS do SGP nao traz nenhum desses. Versao enxuta
   * de getDetalhesTecnicos (sem verificaacesso/sinal), pra nao dobrar as
   * chamadas ao SGP por contrato. `null` = nao deu pra consultar (tenta de
   * novo depois); objeto (com campos possivelmente null) = cliente consultado.
   */
  getContratoCadastro(contratoId: string): Promise<ContratoCadastro | null>;

  /** Anexa uma foto de evidencia a OS, hospedada no proprio SGP. */
  addOsImage(sgpOsId: string, imagemBase64: string, descricao?: string): Promise<void>;

  /** Lista as fotos anexadas a uma OS (sem os bytes). */
  listOsImages(sgpOsId: string): Promise<SgpImagem[]>;

  /** Baixa os bytes de uma foto anexada, pra proxy autenticado ao front. */
  getOsImageFile(anexoId: string): Promise<SgpImagemArquivo | null>;

  // ---- FTTX / provisionamento de ONU (por OLT do provedor) ----

  /** OLTs cadastradas no SGP do provedor. */
  listarOlts(): Promise<Olt[]>;

  /** ONUs que apareceram na OLT mas ainda nao foram autorizadas. */
  listarOnusNaoAutorizadas(oltId: string): Promise<OnuNaoAutorizada[]>;

  /** ONUs ja autorizadas na OLT (opcionalmente filtradas por contrato/CPF). */
  listarOnusAutorizadas(oltId: string, filtro?: { contrato?: string; cpfcnpj?: string }): Promise<OnuAutorizada[]>;

  /** Templates/perfis de ONU disponiveis na OLT. */
  listarTemplatesOnu(oltId: string): Promise<OnuTemplate[]>;

  /** Autoriza (provisiona) uma ONU na OLT — ESCRITA de rede. */
  provisionarOnu(oltId: string, dados: ProvisionarOnuInput): Promise<ProvisionarOnuResultado>;

  /** Desautoriza (remove) uma ONU autorizada — ESCRITA de rede. */
  desautorizarOnu(onuId: string): Promise<{ ok: boolean; mensagem: string | null }>;
}

/** Fabrica de conector a partir de credenciais (um por provedor). */
export type ErpConnectorFactory = (creds: ErpCredentials) => ErpConnector;
