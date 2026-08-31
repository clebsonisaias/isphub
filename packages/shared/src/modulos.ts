import { UserRole } from "./roles.js";

/**
 * Motor de modulos do app do tecnico (Fase 2).
 *
 * `ModuloId` e uma UNIAO FECHADA: o app tem codigo (uma feature-module) por id,
 * entao um id que o app nao conhece nao teria tela. O conjunto e fixo e vive
 * aqui, compartilhado entre API e app — o admin liga/desliga membros deste
 * conjunto, nunca inventa ids.
 */
export const MODULO_IDS = [
  "minhas-os", // CORE — fila pessoal do tecnico
  "evidencias", // camera -> proxy SGP, fila offline
  "rota", // mapa + GPS
  "conexao", // ONU rx/tx, OLT, online/offline
  "provisionamento", // autorizar/desautorizar ONU na OLT (FTTX)
  "assinatura", // assinatura do cliente no fim da OS
  "retiradas", // fila de retirada/cancelamento (equipe externa)
  "notificacoes", // in-app + (depois) push
  "chat", // conversa interna (DM, grupo, thread por OS, avisos)
  "chat-clientes", // caixa de entrada omnichannel de WhatsApp (Meta/Evolution) com clientes
  "linha-movel", // chip CITmax do proprio tecnico (consulta de consumo e plano)
  "financeiro", // contas a pagar/receber DA HUBISP (web apenas — sem tela no app do tecnico)
  "frota", // veiculo, quem esta nele agora (ocupacao por periodo) e onde ele esta (GPS)
] as const;

export type ModuloId = (typeof MODULO_IDS)[number];

/**
 * Modulos que NAO podem ser desativados (login/fila sempre existem). O "core"
 * e propriedade do build, nao dado editavel — por isso vive no codigo, nao no
 * banco. `core=false` fica assim IRREPRESENTAVEL no estado persistido.
 */
export const MODULOS_CORE = ["minhas-os"] as const satisfies readonly ModuloId[];

export function isCore(id: ModuloId): boolean {
  return (MODULOS_CORE as readonly string[]).includes(id);
}

/**
 * Metadados IMUTAVEIS de um modulo — nome, icone, se e core, e os padroes de
 * lancamento (ativo/ordem/roles quando ainda nao ha registro no banco). O banco
 * (ModuloConfig) guarda so o que o admin muda; estes vivem no codigo.
 */
export interface ModuloMeta {
  id: ModuloId;
  nome: string;
  /** Chave de icone (mapeada pra um componente no app/web). */
  icone: string;
  core: boolean;
  /** Ligado no lancamento quando nao ha registro no banco? (core e sempre true.) */
  ativoPadrao: boolean;
  ordemPadrao: number;
  rolesPadrao: UserRole[];
}

/**
 * ADMIN entra em TODO `rolesPadrao`. O app do tecnico e a ferramenta de campo,
 * mas o admin e o superusuario do sistema — quando ele ficava de fora de todos
 * os modulos, `GET /config` devolvia lista vazia e o app abria sem menu nenhum
 * (ver montarModulosHabilitados). Quem quiser esconder um modulo do admin faz
 * isso em /admin/modulos, que grava `rolesPermitidos` no banco e sobrepoe isto.
 */
export const MODULO_CATALOGO: Record<ModuloId, ModuloMeta> = {
  "minhas-os": { id: "minhas-os", nome: "Minhas OS", icone: "list", core: true, ativoPadrao: true, ordemPadrao: 0, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
  conexao: { id: "conexao", nome: "Conexão", icone: "wifi", core: false, ativoPadrao: true, ordemPadrao: 10, rolesPadrao: [UserRole.ADMIN, UserRole.TECNICO] },
  // ativoPadrao:false — nem todo provedor tem FTTX e autorizar e escrita sensivel; o admin liga em /admin/modulos.
  provisionamento: { id: "provisionamento", nome: "Provisionar", icone: "router", core: false, ativoPadrao: false, ordemPadrao: 15, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
  evidencias: { id: "evidencias", nome: "Evidências", icone: "camera", core: false, ativoPadrao: true, ordemPadrao: 20, rolesPadrao: [UserRole.ADMIN, UserRole.TECNICO] },
  rota: { id: "rota", nome: "Rota", icone: "route", core: false, ativoPadrao: true, ordemPadrao: 30, rolesPadrao: [UserRole.ADMIN, UserRole.TECNICO] },
  notificacoes: { id: "notificacoes", nome: "Notificações", icone: "bell", core: false, ativoPadrao: true, ordemPadrao: 40, rolesPadrao: [UserRole.ADMIN, UserRole.TECNICO] },
  assinatura: { id: "assinatura", nome: "Assinatura", icone: "signature", core: false, ativoPadrao: false, ordemPadrao: 50, rolesPadrao: [UserRole.ADMIN, UserRole.TECNICO] },
  retiradas: { id: "retiradas", nome: "Retiradas", icone: "package-x", core: false, ativoPadrao: false, ordemPadrao: 60, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
  // Coordenacao de campo (nao social): DM, grupo, thread por OS, avisos. PROVEDOR nunca participa (ver chatService.podeParticipar).
  chat: { id: "chat", nome: "Chat", icone: "message-circle", core: false, ativoPadrao: true, ordemPadrao: 45, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
  // ativoPadrao:false — inutil ate um admin configurar pelo menos um canal WhatsApp em /admin/canais-whatsapp.
  "chat-clientes": { id: "chat-clientes", nome: "Conversas com clientes", icone: "message-square-text", core: false, ativoPadrao: false, ordemPadrao: 55, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
  /*
   * Dinheiro da PROPRIA HubISP (o que cada provedor paga a ela e o que ela
   * gasta) — nao o financeiro do assinante do provedor.
   *
   * `rolesPadrao: [ADMIN]` e a excecao do catalogo: todo modulo acima e
   * ferramenta de operacao e inclui TECNICO/GESTOR. Este e back-office, e
   * PROVEDOR em particular nunca entra — ver a guarda em routes/financeiro.ts,
   * que nao depende so desta lista.
   *
   * `ativoPadrao: true` (diferente de `chat-clientes`, que nasce desligado):
   * aquele depende de alguem cadastrar um canal de WhatsApp antes de servir
   * pra alguma coisa; este funciona no instante em que a tela abre, sem
   * configurar nada. Nascer desligado so escondia a tela de quem foi
   * procura-la. O recorte que importa aqui e o de PAPEL, nao o de toggle.
   *
   * Sem entrada em ROTAS_MODULO (apps/mobile) de proposito: aquele mapa e
   * `Partial`, entao um modulo sem rota simplesmente nao vira aba no app do
   * tecnico. Existe so na web.
   */
  financeiro: { id: "financeiro", nome: "Financeiro", icone: "wallet", core: false, ativoPadrao: true, ordemPadrao: 70, rolesPadrao: [UserRole.ADMIN] },
  /*
   * O chip da CITmax do proprio tecnico — consumo, plano e status da linha,
   * exibido como cartao dentro do Perfil (nao vira aba, por isso nao entra em
   * ROTAS_MODULO no app).
   *
   * TECNICO nas roles NAO e opcional: e o unico papel que de fato usa a tela, e
   * o /config filtra por papel (moduloService.ts:50). Sem ele o cartao sumiria
   * do app inteiro — que foi exatamente o erro quase cometido com `frota`.
   *
   * `ativoPadrao: true` pelo criterio da casa (precisa de configuracao externa
   * pra servir?): o vinculo da linha vem do cadastro do usuario, nao de chave
   * de integracao, e a tela degrada sozinha ("sem linha vinculada").
   */
  "linha-movel": { id: "linha-movel", nome: "Minha linha", icone: "smartphone", core: false, ativoPadrao: true, ordemPadrao: 75, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
  /*
   * Veiculo, ocupacao (quem esta nele AGORA e quem esteve) e rastreamento GPS.
   *
   * `ativoPadrao: true` pelo mesmo criterio que o financeiro documenta acima: o
   * teste da casa e "precisa de configuracao externa pra servir pra alguma
   * coisa?". `chat-clientes` e `provisionamento` nascem desligados porque sem
   * canal/OLT cadastrados a tela nao faz nada. Frota nao: cadastrar veiculo e
   * declarar ocupacao funcionam assim que a tela abre. So o MAPA depende da
   * chave do rastreador, e ele degrada sozinho ("sem rastreador vinculado") em
   * vez de quebrar.
   *
   * PROVEDOR fica de FORA na fase 1 de proposito. Veiculo de provedor existe no
   * modelo (`Veiculo.provedorId`), mas a posicao de uma viatura mostra a um ISP
   * quando o concorrente foi atendido — as telas escopadas pra ele sao fase
   * posterior. Escopo de DADO e `escopoVeiculoWhere`, nao esta lista.
   *
   * Sem entrada em ROTAS_MODULO (apps/mobile): o app do tecnico nao ganha aba
   * de frota. Ele declara a viatura DENTRO da jornada, que ja e core — um lugar
   * so pra um gesto so.
   */
  frota: { id: "frota", nome: "Frota", icone: "truck", core: false, ativoPadrao: true, ordemPadrao: 80, rolesPadrao: [UserRole.ADMIN, UserRole.GESTOR] },
};

/** Modulo ja resolvido para um usuario (o que `GET /config` devolve). */
export interface ModuloHabilitado {
  id: ModuloId;
  nome: string;
  icone: string;
  core: boolean;
  ordem: number;
}

/** Config efetiva do app para o usuario atual. */
export interface AppConfig {
  modulos: ModuloHabilitado[];
  /** ISO — base pra cache/If-Modified e pra saber "atualizado ha X". */
  geradoEm: string;
}

/** Type guard: uma string qualquer e um ModuloId conhecido? */
export function isModuloId(v: string): v is ModuloId {
  return (MODULO_IDS as readonly string[]).includes(v);
}

/**
 * Tipos de evento do canal realtime (SSE) — escopado por usuario (tecnico no
 * app; tecnico/gestor/admin na web, ver chatService). Os 4 primeiros sao da
 * fila/OS (Fase 2); os 4 "chat-*" sao do chat interno.
 */
export type RealtimeEventoTipo =
  | "os-alterada"
  | "os-atribuida"
  | "os-removida"
  | "config-alterada"
  | "chat-mensagem"
  | "chat-leitura"
  | "chat-digitando"
  | "chat-conversa"
  | "cliente-chat-mensagem"
  | "cliente-chat-conversa"
  /*
   * FROTA. Os dois sao SINAL DE INVALIDACAO — "refaz a tua busca" —, nunca
   * carga de dados. Repare que nao ha lat/lng em RealtimeEvento, e isso e
   * deliberado:
   *
   * (a) o hub e best-effort e NAO tem buffer de replay (ver realtimeHub.ts).
   *     Um evento com coordenada que se perde deixa o mapa velho E plausivel —
   *     pior que um mapa que sabe que esta velho;
   * (b) seria uma segunda fonte de posicao, pra divergir da primeira.
   *
   * `posicao-veiculo` sai COALESCIDO (um por tique de coleta, sem `veiculoId`):
   * carga de tamanho constante independente do tamanho da frota, e nenhum id de
   * veiculo pulverizado via `emitParaTodos` pra quem nao pode ver frota — cada
   * cliente refaz a busca pelo proprio endpoint, ja escopado.
   */
  | "posicao-veiculo"
  | "ocupacao-alterada";

export interface RealtimeEvento {
  tipo: RealtimeEventoTipo;
  /** OS afetada (quando aplicavel) — pra invalidar a query certa no app. */
  osId?: string;
  /** Conversa/mensagem/autor afetados (eventos chat-*). */
  conversaId?: string;
  mensagemId?: string;
  autorId?: string;
  /** ISO. */
  em: string;
}
