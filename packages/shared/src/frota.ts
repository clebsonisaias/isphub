/**
 * Frota — placa, ocupacao e as regras que decidem quem esta em qual veiculo.
 *
 * Tudo aqui e PURO e mora em `shared` pelo mesmo criterio de `navegacao.ts`: sao
 * as partes que erram em SILENCIO. Uma placa normalizada de um jeito na API e de
 * outro na tela nao estoura — vira um veiculo duplicado que ninguem percebe ate
 * o historico de abastecimento estar dividido em dois. E a regra de conflito de
 * ocupacao, se divergir entre servidor e app, faz o tecnico ver uma coisa e o
 * gestor outra, sem erro em lugar nenhum.
 */

// ---------------------------------------------------------------------------
// PLACA
// ---------------------------------------------------------------------------

/**
 * Forma canonica da placa: maiuscula, so [A-Z0-9].
 *
 * "abc-1234", "ABC 1234" e "abc1234" sao A MESMA placa. Guardar as tres seria
 * guardar tres veiculos — e como o vinculo com o rastreador e por veiculo, dois
 * deles ficariam sem rastreador nenhum, em silencio.
 *
 * Esta funcao roda antes de TODO insert/update. E a unica dona dessa regra.
 */
export function normalizarPlaca(bruta: string): string {
  return bruta.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Formato antigo: 3 letras + 4 digitos (AAA1234). */
const PLACA_ANTIGA = /^[A-Z]{3}[0-9]{4}$/;
/** Mercosul: 3 letras + digito + letra + 2 digitos (ABC1D23). */
const PLACA_MERCOSUL = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;

/**
 * Aceita os DOIS formatos que circulam no Brasil hoje.
 *
 * Recebe a placa JA normalizada — validar a forma bruta significaria repetir a
 * limpeza aqui, e duas limpezas divergem.
 *
 * Os dois convivem de verdade: a frota real tem `HFX3652` (antiga) e `NOC4D34`
 * (Mercosul). Aceitar so um dos formatos rejeitaria metade dos carros.
 */
export function placaValida(canonica: string): boolean {
  return PLACA_ANTIGA.test(canonica) || PLACA_MERCOSUL.test(canonica);
}

/**
 * So para EXIBIR. O hifen do formato antigo e convencao de leitura; a placa
 * Mercosul nao tem hifen nenhum e poe-lo ali seria inventar.
 */
export function formatarPlaca(canonica: string): string {
  return PLACA_ANTIGA.test(canonica) ? `${canonica.slice(0, 3)}-${canonica.slice(3)}` : canonica;
}

/**
 * Como o carro aparece pra quem opera: `"C011 · RGI4H16"`.
 *
 * Uma funcao so, e nao cada tela montando a sua, porque o mapa, a lista, o BI e
 * o app precisam dizer a MESMA coisa — duas montagens divergem no dia em que
 * alguem acrescenta o modelo em uma delas, e ai o mesmo carro tem dois nomes
 * dependendo de onde se olha.
 *
 * A PLACA nunca sai: ela e a identidade legal e a chave de busca. O apelido
 * vem na frente porque e o que o olho procura primeiro — num mapa com quatro
 * pontos ninguem lembra qual e RGI4H16, mas todo mundo sabe qual e o C011.
 *
 * Sem apelido devolve so a placa formatada, sem separador orfao.
 */
export function rotuloVeiculo(placaCanonica: string, apelido: string | null | undefined): string {
  const p = formatarPlaca(placaCanonica);
  const a = apelido?.trim();
  return a ? `${a} · ${p}` : p;
}

/**
 * O APELIDO escondido no nome que o aparelho tem na plataforma do fornecedor.
 *
 * De `"C011 - RGI4H16"` sai `"C011"`; de `"C003 - FIAT UNO - HFX 3652"` sai
 * `"C003 FIAT UNO"`. E o inverso de `placaNoApelido`: tira o que e placa e
 * devolve o resto, que e justamente como a operacao chama o carro.
 *
 * `null` quando nao sobra nada — um aparelho chamado so `"RGI4H16"` nao tem
 * apelido, tem placa.
 */
export function apelidoNoNomeDoAparelho(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const pedacos = nome.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);
  const janela = janelaDaPlaca(nome);
  const restantes = janela
    ? [...pedacos.slice(0, janela.de), ...pedacos.slice(janela.ate + 1)]
    : pedacos;
  const resto = restantes.join(" ").trim();
  return resto ? resto.slice(0, 40) : null;
}



/**
 * A placa escondida no APELIDO que o aparelho tem na plataforma do fornecedor.
 *
 * Os nomes vem assim: `"C011 - RGI4H16"`, `"Meu carro"`, `"C013-DWO2H41"`. Quem
 * batizou nao seguiu contrato nenhum, entao isto e um PALPITE — e por ser
 * palpite devolve `null` em vez de forcar: uma placa errada aqui nao produz um
 * cadastro feio, produz um rastreador vinculado ao carro de outra pessoa, e
 * dali em diante o mapa, as viagens e o custo por quilometro ficam todos
 * atribuidos ao veiculo errado.
 *
 * Quebra o nome em pedacos e aceita SO se exatamente um deles for uma placa
 * valida. Dois candidatos = ambiguo = `null`, porque escolher um dos dois seria
 * decidir no lugar de quem sabe.
 */
export function placaNoApelido(apelido: string | null | undefined): string | null {
  return janelaDaPlaca(apelido)?.placa ?? null;
}

/**
 * A placa e ONDE ela esta, em pedacos — a base das duas funcoes acima.
 *
 * Varre janelas CONTIGUAS de pedacos porque a placa nem sempre e um pedaco so:
 * `"C003 - FIAT UNO - HFX 3652"` quebra em cinco, e nem `"HFX"` nem `"3652"`
 * sao placa isolados. Sem juntar vizinhos, o formato antigo escrito com espaco
 * — o mais comum no Brasil — nao seria reconhecido em lugar nenhum.
 *
 * Duas placas DIFERENTES no mesmo nome devolve `null`: e ambiguidade, e
 * escolher uma seria decidir no lugar de quem sabe.
 */
function janelaDaPlaca(
  apelido: string | null | undefined,
): { placa: string; de: number; ate: number } | null {
  if (!apelido) return null;
  const pedacos = apelido.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);

  const achados: { placa: string; de: number; ate: number }[] = [];
  for (let i = 0; i < pedacos.length; i += 1) {
    let junto = "";
    for (let j = i; j < pedacos.length; j += 1) {
      junto += normalizarPlaca(pedacos[j]!);
      if (junto.length > 7) break;
      if (placaValida(junto)) {
        achados.push({ placa: junto, de: i, ate: j });
        break;
      }
    }
  }

  const distintas = [...new Set(achados.map((a) => a.placa))];
  return distintas.length === 1 ? achados[0]! : null;
}



// ---------------------------------------------------------------------------
// ODOMETRO
// ---------------------------------------------------------------------------

/**
 * O odometro so anda pra frente.
 *
 * Um digito a menos no app ("15000" virando "1500") zeraria o historico do
 * veiculo e estragaria todo calculo de consumo depois dele. A regra e do ERP de
 * referencia, onde estava repetida em quatro arquivos — aqui e uma so.
 *
 * Devolve o valor a GRAVAR. `null` informado nao apaga o que existe: nao saber o
 * km agora nao e motivo pra esquecer o de antes.
 */
export function odometroMonotonico(atual: number | null | undefined, informado: number | null | undefined): number | null {
  if (informado == null || !Number.isFinite(informado) || informado < 0) return atual ?? null;
  if (atual == null) return Math.trunc(informado);
  return Math.max(atual, Math.trunc(informado));
}

// ---------------------------------------------------------------------------
// OCUPACAO
// ---------------------------------------------------------------------------

export const PAPEIS_OCUPACAO = ["motorista", "passageiro"] as const;
export type PapelOcupacao = (typeof PAPEIS_OCUPACAO)[number];

export const PAPEL_OCUPACAO_ROTULO: Record<PapelOcupacao, string> = {
  motorista: "Motorista",
  passageiro: "Passageiro",
};

export const ORIGENS_OCUPACAO = ["declaracao", "jornada", "ajuste"] as const;
export type OrigemOcupacao = (typeof ORIGENS_OCUPACAO)[number];

export const ORIGEM_OCUPACAO_ROTULO: Record<OrigemOcupacao, string> = {
  declaracao: "Colega informou",
  jornada: "Declarou na jornada",
  ajuste: "Ajuste do gestor",
};

export const ENCERRAMENTOS_OCUPACAO = ["jornada", "troca_veiculo", "ajuste"] as const;
export type EncerramentoOcupacao = (typeof ENCERRAMENTOS_OCUPACAO)[number];

/**
 * Peso da afirmacao. E o que decide quem vence quando duas pessoas dizem coisas
 * diferentes sobre onde o Pedro esta.
 *
 * A pessoa sabe melhor que o colega onde ela esta; e o gestor, corrigindo depois
 * com a informacao toda na mao, sabe melhor que os dois.
 */
export function pesoOrigem(o: OrigemOcupacao): 1 | 2 | 3 {
  if (o === "ajuste") return 3;
  if (o === "jornada") return 2;
  return 1;
}

export interface OcupacaoCorrente {
  id: string;
  veiculoId: string;
  papel: PapelOcupacao;
  origem: OrigemOcupacao;
}

export interface OcupacaoPretendida {
  veiculoId: string;
  papel: PapelOcupacao;
  origem: OrigemOcupacao;
}

export type DecisaoOcupacao =
  | { tipo: "abrir" }
  /** Ja esta exatamente assim — nao escreve nada, e nao e erro. */
  | { tipo: "manter" }
  | { tipo: "mover"; fecharOcupacaoId: string }
  /** Uma afirmacao mais fraca nao desloca uma mais forte. */
  | { tipo: "recusar"; motivo: "declaracao_mais_fraca"; veiculoIdAtual: string; ocupacaoIdAtual: string };

/**
 * Quem vence.
 *
 * O caso que esta regra existe pra resolver: o Joao inicia a jornada, escolhe a
 * HFX3652 e marca que o Pedro vai junto — a linha do Pedro nasce sem ele tocar
 * em nada, senao "N tecnicos por viatura" nunca sai do papel. Meia hora depois o
 * Pedro inicia a propria jornada em outro carro. O Pedro vence, porque ele sabe
 * onde esta; a linha antiga fecha e a dele abre.
 *
 * O contrario tambem vale: se o Pedro ja tinha se declarado, o Joao nao consegue
 * move-lo — e a tela do Joao DIZ isso, em vez de fingir que gravou.
 *
 * Compara `(veiculoId, papel)` e nao so o veiculo: sem o papel, o Pedro parado
 * no carro como passageiro declarado nunca conseguiria virar motorista.
 */
export function decidirOcupacao(atual: OcupacaoCorrente | null, nova: OcupacaoPretendida): DecisaoOcupacao {
  if (!atual) return { tipo: "abrir" };
  if (atual.veiculoId === nova.veiculoId && atual.papel === nova.papel) return { tipo: "manter" };

  if (pesoOrigem(nova.origem) < pesoOrigem(atual.origem)) {
    return {
      tipo: "recusar",
      motivo: "declaracao_mais_fraca",
      veiculoIdAtual: atual.veiculoId,
      ocupacaoIdAtual: atual.id,
    };
  }
  return { tipo: "mover", fecharOcupacaoId: atual.id };
}

// ---------------------------------------------------------------------------
// INTERVALOS
// ---------------------------------------------------------------------------

export interface PeriodoOcupacao {
  usuarioId: string;
  veiculoId: string;
  inicioEm: string;
  fimEm: string | null;
}

/**
 * O intervalo e SEMIABERTO: `[inicio, fim)`.
 *
 * Numa troca de viatura as 13:30 em ponto, a ocupacao antiga fecha e a nova abre
 * no mesmo instante. Com intervalo fechado dos dois lados, as 13:30 a pessoa
 * estaria nos DOIS carros — e "quem estava no carro" deixaria de ter resposta
 * unica exatamente no momento que mais interessa.
 *
 * A mesma convencao vale na consulta SQL e na restricao de sobreposicao do
 * banco. Uma so, em todo lugar.
 */
export function cobreInstante(p: { inicioEm: string; fimEm: string | null }, instante: Date): boolean {
  const t = instante.getTime();
  const inicio = Date.parse(p.inicioEm);
  if (Number.isNaN(inicio) || inicio > t) return false;
  if (p.fimEm == null) return true;
  const fim = Date.parse(p.fimEm);
  return Number.isNaN(fim) ? true : fim > t;
}

/** Quem estava neste veiculo naquele instante. */
export function quemEstavaEm(periodos: PeriodoOcupacao[], veiculoId: string, instante: Date): PeriodoOcupacao[] {
  return periodos.filter((p) => p.veiculoId === veiculoId && cobreInstante(p, instante));
}

/**
 * Em qual veiculo esta pessoa estava naquele instante.
 *
 * Devolve um so porque o indice parcial `ocupacoes_veiculo_uma_aberta_por_usuario`
 * garante isso NO BANCO — nao e otimismo do cliente.
 */
export function veiculoDeEm(periodos: PeriodoOcupacao[], usuarioId: string, instante: Date): PeriodoOcupacao | null {
  return periodos.find((p) => p.usuarioId === usuarioId && cobreInstante(p, instante)) ?? null;
}

// ---------------------------------------------------------------------------
// VEICULO
// ---------------------------------------------------------------------------

export const TIPOS_VEICULO = ["carro", "moto", "van", "caminhao", "utilitario"] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];

export const TIPO_VEICULO_ROTULO: Record<TipoVeiculo, string> = {
  carro: "Carro",
  moto: "Moto",
  van: "Van",
  caminhao: "Caminhão",
  utilitario: "Utilitário",
};

export const STATUS_VEICULO = ["ativo", "manutencao", "inativo"] as const;
export type StatusVeiculo = (typeof STATUS_VEICULO)[number];

export const STATUS_VEICULO_ROTULO: Record<StatusVeiculo, string> = {
  ativo: "Ativo",
  manutencao: "Em manutenção",
  inativo: "Inativo",
};

/**
 * Ocupacao aberta ha tempo demais.
 *
 * NAO fecha sozinha, de proposito — mesma decisao ja tomada na jornada
 * (`JORNADA_LONGA_MS`): fechar por conta propria inventaria um horario de saida
 * que ninguem viveu, e esse horario iria pro historico como se fosse fato.
 * Sinaliza pro gestor e deixa a correcao com quem sabe.
 */
export const OCUPACAO_LONGA_MS = 12 * 60 * 60_000;

export function ocupacaoPrecisaAtencao(inicioEm: string, agora: Date): boolean {
  const inicio = Date.parse(inicioEm);
  if (Number.isNaN(inicio)) return false;
  return agora.getTime() - inicio >= OCUPACAO_LONGA_MS;
}

/**
 * Pictograma do veiculo no mapa.
 *
 * Emoji aqui, e nao icone de biblioteca, por uma razao especifica de MAPA: o
 * marcador precisa dizer O QUE e o veiculo num alvo de ~26px, sem legenda e sem
 * cor disponivel (o pino ja usa cor e halo pra ESTADO). Um pictograma colorido
 * resolve isso melhor que um glifo monocromatico.
 *
 * Isto NAO abre excecao pro resto da interface: em botao, menu e lista o
 * sistema continua com lucide. Emoji como icone de UI e ruim porque muda de
 * desenho a cada plataforma e nao herda cor de tema — num marcador de mapa,
 * nenhuma das duas coisas atrapalha.
 */
export const EMOJI_VEICULO: Record<TipoVeiculo, string> = {
  carro: "🚗",
  moto: "🏍️",
  van: "🚐",
  caminhao: "🚛",
  utilitario: "🛻",
};

// ---------------------------------------------------------------------------
// VIATURA FIXA — o carro de cada tecnico, definido pelo gestor
// ---------------------------------------------------------------------------

/** Um periodo em que o tecnico teve aquele carro como fixo. `fimEm` nulo = vigente. */
export interface ViaturaFixaPublic {
  id: string;
  usuarioId: string;
  usuarioNome: string;
  veiculoId: string;
  veiculoPlaca: string;
  veiculoApelido: string | null;
  papel: "motorista" | "passageiro";
  inicioEm: string;
  fimEm: string | null;
  definidoPor: string;
  definidoPorNome: string | null;
  encerradoPor: string | null;
  encerradoPorNome: string | null;
  observacao: string | null;
}

/** Linha do quadro "tecnico → carro fixo" do gestor. Sem carro = `viatura` nula. */
export interface TecnicoComViaturaFixa {
  usuarioId: string;
  nome: string;
  viatura: ViaturaFixaPublic | null;
}
