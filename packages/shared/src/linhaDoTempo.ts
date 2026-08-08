import type { Segmento } from "./geodesia.js";
import type { OrigemOcupacao, PapelOcupacao } from "./frota.js";
import type { OsEvento } from "./types.js";

/**
 * A linha do tempo do dia de uma viatura — quatro fontes viradas numa historia.
 *
 * A MESCLA e pura e mora aqui, mas quem BUSCA e o servidor, e isso nao e
 * detalhe: as quatro fontes tem quatro autorizacoes diferentes (evento de OS
 * passa por `podeAcessarOs`, jornada e de gestor, posicao depende de ter
 * ocupado o veiculo). Montar no cliente exigiria expor as quatro pontas e
 * confiar que toda tela componha as guardas certas.
 *
 * Alem disso o corte do dia e o `diaBrasileiro()`, e as quatro fontes tem de ser
 * cortadas pelo MESMO. Fazendo uma vez no servidor, nao existe a chance de um
 * cliente cortar na meia-noite UTC.
 */

export interface ItemOcupacao {
  em: string;
  usuarioNome: string;
  papel: PapelOcupacao;
  origem: OrigemOcupacao;
  declaradoPorNome: string;
  lat: number | null;
  lng: number | null;
}

export type ItemLinhaTempo =
  | { tipo: "jornada_inicio" | "jornada_fim"; em: string; usuarioNome: string; lat: number | null; lng: number | null }
  | ({ tipo: "ocupacao_inicio" | "ocupacao_fim" } & ItemOcupacao)
  | {
      tipo: "os_evento";
      em: string;
      osId: string;
      sgpOsId: string | null;
      eventoTipo: OsEvento["tipo"];
      descricao: string;
      autorNome: string | null;
      lat: number | null;
      lng: number | null;
    }
  | { tipo: "parada"; em: string; ateEm: string; duracaoMin: number; lat: number; lng: number }
  | { tipo: "deslocamento"; em: string; ateEm: string; distanciaMetros: number; velocidadeMaxKmh: number | null };

/**
 * Ordem fixa para empate de horario.
 *
 * Sem isto o mesmo dia aparece diferente a cada refresh, porque `Array.sort` nao
 * e estavel entre execucoes com chaves iguais. Uma tela que muda sozinha lê como
 * bug e destroi a confianca no historico — que e justamente o que esta tela
 * existe pra construir.
 *
 * A ordem conta uma historia: o turno abre, a pessoa entra no carro, o trabalho
 * acontece, a pessoa sai, o turno fecha.
 */
const RANK: Record<ItemLinhaTempo["tipo"], number> = {
  jornada_inicio: 0,
  ocupacao_inicio: 1,
  os_evento: 2,
  deslocamento: 3,
  parada: 4,
  ocupacao_fim: 5,
  jornada_fim: 6,
};

export interface FontesLinhaTempo {
  jornadas: { usuarioNome: string; inicioEm: string; fimEm: string | null; latInicio: number | null; lngInicio: number | null; latFim: number | null; lngFim: number | null }[];
  ocupacoes: {
    usuarioNome: string;
    papel: PapelOcupacao;
    origem: OrigemOcupacao;
    declaradoPorNome: string;
    inicioEm: string;
    fimEm: string | null;
    latInicio: number | null;
    lngInicio: number | null;
    latFim: number | null;
    lngFim: number | null;
  }[];
  osEventos: {
    em: string;
    osId: string;
    sgpOsId: string | null;
    eventoTipo: OsEvento["tipo"];
    descricao: string;
    autorNome: string | null;
    lat: number | null;
    lng: number | null;
  }[];
  segmentos: Segmento[];
}

export function montarLinhaDoTempo(fontes: FontesLinhaTempo): ItemLinhaTempo[] {
  const itens: ItemLinhaTempo[] = [];

  for (const j of fontes.jornadas) {
    itens.push({ tipo: "jornada_inicio", em: j.inicioEm, usuarioNome: j.usuarioNome, lat: j.latInicio, lng: j.lngInicio });
    // Jornada aberta nao gera item de fim: ela nao acabou, e inventar um horario
    // de fim poria no historico um fato que nao aconteceu.
    if (j.fimEm) {
      itens.push({ tipo: "jornada_fim", em: j.fimEm, usuarioNome: j.usuarioNome, lat: j.latFim, lng: j.lngFim });
    }
  }

  for (const o of fontes.ocupacoes) {
    const comum = {
      usuarioNome: o.usuarioNome,
      papel: o.papel,
      origem: o.origem,
      declaradoPorNome: o.declaradoPorNome,
    };
    itens.push({ tipo: "ocupacao_inicio", em: o.inicioEm, lat: o.latInicio, lng: o.lngInicio, ...comum });
    if (o.fimEm) {
      itens.push({ tipo: "ocupacao_fim", em: o.fimEm, lat: o.latFim, lng: o.lngFim, ...comum });
    }
  }

  for (const e of fontes.osEventos) {
    itens.push({
      tipo: "os_evento",
      em: e.em,
      osId: e.osId,
      sgpOsId: e.sgpOsId,
      eventoTipo: e.eventoTipo,
      descricao: e.descricao,
      autorNome: e.autorNome,
      lat: e.lat,
      lng: e.lng,
    });
  }

  for (const s of fontes.segmentos) {
    if (s.tipo === "parada") {
      itens.push({ tipo: "parada", em: s.de, ateEm: s.ate, duracaoMin: s.duracaoMin, lat: s.lat, lng: s.lng });
    } else {
      itens.push({
        tipo: "deslocamento",
        em: s.de,
        ateEm: s.ate,
        distanciaMetros: s.distanciaMetros,
        velocidadeMaxKmh: s.velocidadeMaxKmh,
      });
    }
  }

  return itens.sort((a, b) => {
    const ta = Date.parse(a.em);
    const tb = Date.parse(b.em);
    if (ta !== tb) return ta - tb;
    return RANK[a.tipo] - RANK[b.tipo];
  });
}
