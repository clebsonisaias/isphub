/**
 * A LINHA DO TEMPO DO VEICULO: tudo o que aconteceu com o carro, em ordem,
 * agrupado por dia — quem pegou e devolveu, checklists, abastecimentos,
 * manutencoes, alarmes do rastreador e trocas do carro fixo.
 *
 * Diferente de `linhaDoTempo.ts`, que conta o dia de TRABALHO de uma viatura
 * (jornada, OS, deslocamentos). Esta conta a vida do CARRO.
 *
 * Quem BUSCA e o servidor (cada fonte tem a sua tabela e o escopo e por
 * veiculo); aqui so a ordenacao e o agrupamento, que sao puros e testaveis.
 */

import type { EventoRastreadorTipo } from "./sensores.js";
import type { PapelOcupacao, OrigemOcupacao } from "./frota.js";
import type { TipoCombustivel } from "./financeiro.js";
import { OFFSET_BR_MIN } from "./dia.js";

/**
 * Eventos do rastreador que entram como ALARME. Ignicao liga/desliga fica de
 * fora: acontece dezenas de vezes por dia e ja aparece como viagem no historico
 * do dia — na linha do tempo so afogaria o que importa.
 */
export const ALARMES_VEICULO = [
  "bateria_baixa",
  "bateria_normalizada",
  "bloqueio_ativado",
  "bloqueio_removido",
  "parado_com_motor_ligado",
  "excesso_velocidade",
  "ignicao_anomalia",
  "ficou_offline",
  "voltou_online",
] as const satisfies readonly EventoRastreadorTipo[];
export type AlarmeVeiculo = (typeof ALARMES_VEICULO)[number];

/** O alarme pede atencao (vermelho) ou so avisa que voltou ao normal? */
export const ALARME_GRAVE: Record<AlarmeVeiculo, boolean> = {
  bateria_baixa: true,
  bateria_normalizada: false,
  bloqueio_ativado: true,
  bloqueio_removido: false,
  parado_com_motor_ligado: true,
  excesso_velocidade: true,
  ignicao_anomalia: true,
  ficou_offline: true,
  voltou_online: false,
};

export type ItemLinhaVeiculo =
  | {
      tipo: "retirada";
      em: string;
      usuarioNome: string;
      papel: PapelOcupacao;
      /** `ajuste` = o gestor colocou; `jornada` = o proprio tecnico; `declaracao` = um colega. */
      origem: OrigemOcupacao;
      declaradoPorNome: string;
      odometroKm: number | null;
    }
  | {
      tipo: "devolucao";
      em: string;
      usuarioNome: string;
      papel: PapelOcupacao;
      /** Por que a ocupacao fechou: fim do turno, troca de carro ou ajuste do gestor. */
      motivo: "jornada" | "troca_veiculo" | "ajuste" | null;
      odometroKm: number | null;
    }
  | {
      tipo: "checklist";
      em: string;
      id: string;
      momento: "saida" | "retorno";
      usuarioNome: string;
      odometroKm: number | null;
      combustivelPct: number | null;
      avarias: string | null;
      temFoto: boolean;
    }
  | {
      tipo: "abastecimento";
      /** So a DATA e conhecida (o cadastro nao guarda hora): `semHora` avisa a tela. */
      em: string;
      semHora: true;
      litros: number;
      valorTotal: number;
      km: number;
      combustivel: TipoCombustivel;
      posto: string | null;
      tanqueCheio: boolean;
      responsavelNome: string | null;
    }
  | { tipo: "manutencao"; em: string; servico: string; km: number | null; registradoPorNome: string | null }
  | { tipo: "alarme"; em: string; evento: AlarmeVeiculo; grave: boolean }
  | {
      tipo: "carro_fixo";
      em: string;
      usuarioNome: string;
      /** `definido` = passou a ser o carro fixo do tecnico; `encerrado` = deixou de ser. */
      acao: "definido" | "encerrado";
      porNome: string | null;
    };

export interface DiaLinhaVeiculo {
  /** "2026-11-06", no fuso de Brasilia. */
  dia: string;
  itens: ItemLinhaVeiculo[];
}

export interface LinhaDoVeiculo {
  de: string;
  ate: string;
  agoraServidor: string;
  /** Do dia mais RECENTE pro mais antigo; dias sem nada nao aparecem. */
  dias: DiaLinhaVeiculo[];
  /** Algum tipo bateu no teto de linhas e o periodo pode estar incompleto. */
  truncado: boolean;
}

/**
 * Ordem no MESMO instante, contando uma historia: o carro passa a ser de
 * alguem, a pessoa pega, faz o checklist de saida... e no fim faz o de retorno
 * e devolve. Sem isto o empate muda de ordem a cada atualizacao.
 */
const RANK: Record<ItemLinhaVeiculo["tipo"], number> = {
  carro_fixo: 0,
  retirada: 1,
  checklist: 2,
  abastecimento: 3,
  manutencao: 4,
  alarme: 5,
  devolucao: 6,
};

function diaBr(iso: string): string {
  return new Date(Date.parse(iso) + OFFSET_BR_MIN * 60_000).toISOString().slice(0, 10);
}

/** Checklist de retorno vem ANTES da devolucao no empate; o de saida, depois da retirada. */
function rank(i: ItemLinhaVeiculo): number {
  if (i.tipo === "checklist" && i.momento === "retorno") return RANK.devolucao - 0.5;
  return RANK[i.tipo];
}

/**
 * Agrupa por dia (Brasilia) e ordena. Dentro do dia, em ordem CRONOLOGICA
 * (le-se como uma historia); os dias, do mais recente pro mais antigo (quem
 * abre a tela quer saber de hoje primeiro).
 */
export function agruparLinhaDoVeiculo(itens: ItemLinhaVeiculo[]): DiaLinhaVeiculo[] {
  const porDia = new Map<string, ItemLinhaVeiculo[]>();
  for (const i of itens) {
    const d = diaBr(i.em);
    const lista = porDia.get(d);
    if (lista) lista.push(i);
    else porDia.set(d, [i]);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dia, lista]) => ({
      dia,
      itens: lista.sort((a, b) => {
        // Abastecimento so tem data: vai pro comeco do dia em vez de fingir uma hora.
        const ta = a.tipo === "abastecimento" ? -Infinity : Date.parse(a.em);
        const tb = b.tipo === "abastecimento" ? -Infinity : Date.parse(b.em);
        if (ta !== tb) return ta - tb;
        return rank(a) - rank(b);
      }),
    }));
}
