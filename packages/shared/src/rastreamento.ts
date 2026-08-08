/**
 * Contrato do fornecedor de rastreamento.
 *
 * A tela NUNCA fala com a PlataformaTK — fala com `Rastreador`. Esta interface e
 * a fronteira: trocar de fornecedor e escrever outro conector, sem tocar em rota
 * nem em componente.
 *
 * O primeiro (e hoje unico) fornecedor e a PlataformaTK. O contrato abaixo foi
 * CONFERIDO contra a API de producao, nao copiado de outra integracao — e ainda
 * bem, porque a integracao de referencia le o status errado (ver abaixo):
 *
 *   Authorization: AuthDevice <chave>
 *
 *   GET /trackers/status            -> [{ trackerId: number, statuses: [{name, status}] }]
 *        nomes vistos: COMMUNICATION (UP|DOWN), TRACKING (ON|OFF),
 *        MOVEMENT (MOVING|STOPPED), ACC (ON|OFF = ignicao),
 *        CUT (OFF = corte de motor), BAT ("100" = bateria %).
 *        ⚠️ Rastreador offline reporta SO o COMMUNICATION — os outros SOMEM.
 *           Por isso cada campo e tri-estado: ausente = nao sabemos.
 *
 *   GET /trackers/{id}/last-location
 *        -> { trackerId, latitude, longitude, time, lastCommunication, speed }
 *        `time` e o carimbo DO APARELHO (a verdade); `lastCommunication` e
 *        quando o servidor recebeu.
 *
 *   GET /trackers/{id}/history/{ini}[/{fim}]?distance=&accuracy=
 *   GET /trackers/{id}/day-summary/{data}[/{fim}]
 *
 * Codigos: rastreador inexistente devolve **400**, nao 404; sem chave, 401.
 *
 * ⚠️ O ERRO DA INTEGRACAO DE REFERENCIA, que nao repetimos: ela le
 * `s.status.COMMUNICATION`, como se `status` fosse um objeto indexado por nome.
 * O campo real chama-se `statuses` e e um ARRAY de `{name, status}`. Resultado:
 * la, `online` e `gpsOk` sao SEMPRE falsos, e ninguem percebeu porque falso e um
 * valor plausivel pra um carro parado.
 *
 * Tres fatos do fornecedor que atravessam o desenho inteiro: nao ha webhook (e
 * polling), so o status vem em lote (posicao e uma chamada por rastreador), e a
 * chave nao tem escopo de empresa (uma chave = a conta toda).
 */

import type { Ignicao, MapaSensores } from "./sensores.js";

export const RASTREADOR_FORNECEDORES = ["plataformatk"] as const;
export type RastreadorFornecedor = (typeof RASTREADOR_FORNECEDORES)[number];

export interface RastreadorCredenciais {
  baseUrl: string;
  chave: string;
}

/**
 * "Nao sei" e um estado de primeira classe.
 *
 * Esta uniao existe por causa de um incidente real: em `ResultadoStatusOs`, um
 * `null` significava ao mesmo tempo "a OS nao existe mais" e "nao deu pra
 * consultar" — e a reconciliacao cancelou OS viva por causa disso. Aqui o mesmo
 * risco: `null` querendo dizer tanto "o rastreador esta parado sem sinal" quanto
 * "a API caiu" faria o mapa apagar um carro que esta na rua.
 *
 * `indeterminado` NUNCA justifica gravar nada.
 */
export type ResultadoPosicao =
  | { tipo: "posicao"; lat: number; lng: number; registradoEm: string; velocidadeKmh: number | null }
  /** Prova positiva: o fornecedor respondeu, este rastreador nunca reportou. */
  | { tipo: "sem_posicao" }
  | { tipo: "indeterminado"; motivo: string };

export interface StatusRastreador {
  identificadorExterno: string;

  /**
   * O mapa CRU de todos os sensores, como o fornecedor mandou.
   *
   * E a fonte; os campos abaixo sao LEITURAS dele, feitas pelas funcoes de
   * `sensores.ts`. Guardar o mapa inteiro e o que permite um sensor novo
   * (temperatura, porta, carga) aparecer na tela sem migracao nem codigo.
   */
  sensores: MapaSensores;

  /**
   * Todos tri-estado, e isso NAO e zelo excessivo: um rastreador offline
   * reporta so o COMMUNICATION, e os demais campos simplesmente nao vem.
   * `false` diria "o GPS esta sem fix"; `null` diz "nao sabemos" — que e a
   * verdade, e a diferenca decide se o mapa apaga um carro ou o mostra velho.
   */
  /** COMMUNICATION — o aparelho fala com o servidor. */
  comunicando: boolean | null;
  /** TRACKING — o GPS tem fix. */
  rastreando: boolean | null;
  /** MOVEMENT. Cuidado: o aparelho responde `UNDEFINED`, que vira `null`. */
  movendo: boolean | null;
  /** ACC. QUATRO estados contando o `null` — ver `Ignicao`. */
  ignicao: Ignicao;
  /** BAT em porcentagem. */
  bateriaPct: number | null;
  /** CUT — o veiculo esta bloqueado pelo aparelho. */
  bloqueado: boolean | null;
}

export type ResultadoStatus =
  | { tipo: "lista"; itens: StatusRastreador[] }
  | { tipo: "indeterminado"; motivo: string };

/**
 * O cadastro do aparelho no fornecedor — o que a tela precisa dizer sobre o
 * hardware sem ninguem digitar nada.
 *
 * O que NAO esta aqui e tao intencional quanto o que esta: a resposta real traz
 * `password` (senha SMS em texto puro), `imei`, `phoneNumber` e `apnPassword`.
 * Nenhum deles entra no nosso modelo.
 */
export interface CadastroRastreador {
  identificadorExterno: string;
  /** "CRX" — o modelo do aparelho. */
  modelo: string | null;
  /** "C003 - FIAT UNO - HFX 3652" — como o cliente batizou la. */
  nome: string | null;
  /** De quanto em quanto tempo o aparelho transmite. */
  intervaloSegundos: number | null;
  /**
   * Se o aparelho ACEITA comando de corte de motor.
   *
   * Guardamos so pra INFORMAR. O ISPhub nao envia comando nenhum — quem bloqueia
   * segue sendo a plataforma do fornecedor, que ja tem o controle e a
   * responsabilidade.
   */
  temComandoCorte: boolean;
  instaladoEm: string | null;
}

export type ResultadoCadastro =
  | { tipo: "lista"; itens: CadastroRastreador[] }
  | { tipo: "indeterminado"; motivo: string };

export type ResultadoDicionario =
  | { tipo: "dicionario"; dados: unknown }
  | { tipo: "indeterminado"; motivo: string };

export interface PontoHistorico {
  lat: number;
  lng: number;
  registradoEm: string;
  velocidadeKmh: number | null;
}

export type ResultadoHistorico =
  | { tipo: "trecho"; pontos: PontoHistorico[] }
  | { tipo: "indeterminado"; motivo: string };

export interface ResumoDia {
  /** YYYY-MM-DD. */
  data: string;
  /**
   * METROS — e o nome do campo diz isso de proposito.
   *
   * O fornecedor devolve `distance` em metros e a integracao de referencia
   * dividia por 1000 na hora de usar. Um `/1000` esquecido vira relatorio mil
   * vezes errado, e um numero mil vezes maior nao parece obviamente errado num
   * painel. Converte so na exibicao.
   */
  distanciaMetros: number;
  velocidadeMaximaKmh: number | null;
  apelidoRastreador: string | null;
}

export type ResultadoResumoDia =
  | { tipo: "resumo"; dias: ResumoDia[] }
  | { tipo: "indeterminado"; motivo: string };

export interface RastreadorConnector {
  testarConexao(): Promise<{ ok: boolean; mensagem?: string }>;
  /** A UNICA chamada em lote — 1 requisicao cobre a frota inteira. */
  statusDeTodos(): Promise<ResultadoStatus>;
  /** Cadastro de todos os aparelhos. Tambem em lote, tambem 1 requisicao. */
  cadastroDeTodos(): Promise<ResultadoCadastro>;
  /**
   * O dicionario de sensores (`GET /status-descriptions`).
   *
   * Devolve `unknown` de proposito: e um documento do FORNECEDOR, guardado como
   * veio num `Json`. Tipar campo a campo aqui obrigaria uma migracao toda vez
   * que eles acrescentassem uma chave — exatamente o acoplamento que o desenho
   * generico existe pra evitar. Quem da sentido a ele e `sensores.ts`, na
   * leitura, tolerando o que nao conhece.
   */
  dicionarioDeSensores(): Promise<ResultadoDicionario>;
  ultimaPosicao(identificadorExterno: string): Promise<ResultadoPosicao>;
  historico(
    identificadorExterno: string,
    inicioIso: string,
    fimIso?: string,
    opcoes?: { distanciaM?: number; precisao?: "high" | "medium" | "low" },
  ): Promise<ResultadoHistorico>;
  resumoDeDias(identificadorExterno: string, dataInicio: string, dataFim?: string): Promise<ResultadoResumoDia>;
}

export type RastreadorConnectorFactory = (creds: RastreadorCredenciais) => RastreadorConnector;

// ---------------------------------------------------------------------------
// EXIBICAO
// ---------------------------------------------------------------------------

/**
 * Ha quanto tempo esta posicao foi registrada.
 *
 * Toda posicao na tela vem acompanhada da idade dela. Um mapa que nao sabe dizer
 * que esta velho e pior que nenhum mapa: o gestor despacha achando que o carro
 * esta onde o pino mostra.
 */
export function idadeDaPosicao(registradoEm: string, agora: Date): string {
  const t = Date.parse(registradoEm);
  if (Number.isNaN(t)) return "—";
  const segundos = Math.max(0, Math.round((agora.getTime() - t) / 1000));
  if (segundos < 60) return "agora";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  return `há ${Math.round(horas / 24)}d`;
}

/** Acima disto a posicao e velha o bastante pra nao servir de base pra decisao. */
export const POSICAO_VELHA_MS = 15 * 60_000;

export function posicaoVelha(registradoEm: string, agora: Date): boolean {
  const t = Date.parse(registradoEm);
  return Number.isNaN(t) ? true : agora.getTime() - t >= POSICAO_VELHA_MS;
}

export function formatarDistancia(metros: number): string {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1)} km`;
}
