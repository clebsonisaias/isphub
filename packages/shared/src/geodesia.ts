/**
 * Contas sobre coordenadas — distancia, simplificacao de trilha e deteccao de
 * paradas.
 *
 * Chama-se `geodesia` e nao `geo` de proposito: `apps/api/src/lib/geo.ts` ja
 * existe e faz outra coisa (e a fronteira de ENTRADA, o zod que valida
 * lat/lng de um corpo de requisicao). Dois arquivos `geo` em imports vizinhos
 * seria convite pro import errado.
 *
 * Mora em `shared` porque web e API precisam das MESMAS contas: o servidor
 * decima a trilha antes de mandar, o navegador desenha o que recebeu, e se as
 * duas pontas discordassem sobre distancia o painel mostraria um km e o
 * relatorio outro.
 */

const RAIO_TERRA_M = 6_371_000;

export interface Ponto {
  lat: number;
  lng: number;
}

export interface PontoNoTempo extends Ponto {
  /** ISO. */
  em: string;
  velocidadeKmh?: number | null;
}

function rad(graus: number): number {
  return (graus * Math.PI) / 180;
}

/** Distancia em METROS entre dois pontos (haversine). */
export function haversineMetros(a: Ponto, b: Ponto): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return RAIO_TERRA_M * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Soma dos trechos consecutivos, em metros. */
export function distanciaTotalMetros(pontos: Ponto[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) total += haversineMetros(pontos[i - 1]!, pontos[i]!);
  return total;
}

/**
 * Projecao local em metros, com origem no primeiro ponto.
 *
 * Equirretangular: erra em escala continental e e exata o bastante em escala de
 * cidade, que e onde uma viatura anda. Serve so pra medir desvio na
 * simplificacao — nunca pra exibir posicao.
 */
function paraPlano(p: Ponto, origem: Ponto): { x: number; y: number } {
  return {
    x: rad(p.lng - origem.lng) * Math.cos(rad(origem.lat)) * RAIO_TERRA_M,
    y: rad(p.lat - origem.lat) * RAIO_TERRA_M,
  };
}

function desvioPerpendicularM(p: Ponto, a: Ponto, b: Ponto): number {
  const pa = paraPlano(a, a);
  const pb = paraPlano(b, a);
  const pp = paraPlano(p, a);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const comprimento2 = dx * dx + dy * dy;
  // Extremos coincidentes: o "segmento" e um ponto, entao o desvio e a distancia ate ele.
  if (comprimento2 === 0) return Math.hypot(pp.x - pa.x, pp.y - pa.y);
  const t = ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / comprimento2;
  const tf = Math.max(0, Math.min(1, t));
  return Math.hypot(pp.x - (pa.x + tf * dx), pp.y - (pa.y + tf * dy));
}

/**
 * Douglas-Peucker: joga fora os pontos que nao mudam o DESENHO da trilha.
 *
 * Um dia de 10h sao ~1.200 pontos, e a esmagadora maioria esta em linha reta
 * numa avenida. Mandar todos infla o JSON sem acrescentar um pixel.
 *
 * As DUAS PONTAS sempre ficam: sao onde o trecho comeca e termina, e cortar uma
 * delas moveria o inicio ou o fim do percurso.
 */
export function simplificarTrilha<T extends Ponto>(pontos: T[], toleranciaMetros = 15): T[] {
  if (pontos.length <= 2 || toleranciaMetros <= 0) return [...pontos];

  const manter = new Array<boolean>(pontos.length).fill(false);
  manter[0] = true;
  manter[pontos.length - 1] = true;

  // Pilha em vez de recursao: 1.200 pontos quase colineares degeneram numa
  // recursao profunda, e estourar a pilha aqui derrubaria a rota inteira.
  const pilha: [number, number][] = [[0, pontos.length - 1]];
  while (pilha.length) {
    const [ini, fim] = pilha.pop()!;
    if (fim - ini < 2) continue;
    let piorIdx = -1;
    let piorDesvio = toleranciaMetros;
    for (let i = ini + 1; i < fim; i++) {
      const d = desvioPerpendicularM(pontos[i]!, pontos[ini]!, pontos[fim]!);
      if (d > piorDesvio) {
        piorDesvio = d;
        piorIdx = i;
      }
    }
    if (piorIdx === -1) continue;
    manter[piorIdx] = true;
    pilha.push([ini, piorIdx], [piorIdx, fim]);
  }

  return pontos.filter((_, i) => manter[i]);
}

// ---------------------------------------------------------------------------
// PARADAS E DESLOCAMENTOS
// ---------------------------------------------------------------------------

export interface OpcoesSegmentacao {
  /** Abaixo disto o veiculo e considerado parado. */
  velocidadeParadoKmh?: number;
  /** Ficar quieto menos que isto e semaforo, nao parada. */
  duracaoMinimaParadaMin?: number;
  /** Raio dentro do qual o GPS ainda esta "no mesmo lugar". */
  raioParadaM?: number;
}

export type Segmento =
  | { tipo: "parada"; de: string; ate: string; duracaoMin: number; lat: number; lng: number }
  | { tipo: "deslocamento"; de: string; ate: string; distanciaMetros: number; velocidadeMaxKmh: number | null };

/**
 * Transforma uma nuvem de pontos em "ficou parado aqui" e "andou dali pra ca".
 *
 * Sem isto a linha do tempo do dia sao 1.200 linhas identicas e os eventos que
 * importam (chegou no cliente, iniciou a OS) se afogam no meio — o oposto do
 * objetivo de mesclar as fontes.
 *
 * O RAIO e a parte que faz funcionar. Um GPS parado nao repete a mesma
 * coordenada: ele treme dezenas de metros. Comparar ponto a ponto quebraria uma
 * parada de duas horas em centenas de micro-paradas. Aqui o ponto de ancora e o
 * primeiro da parada, e todo ponto dentro do raio dele continua sendo a MESMA
 * parada.
 */
export function segmentarParadas(pontos: PontoNoTempo[], opcoes: OpcoesSegmentacao = {}): Segmento[] {
  const velocidadeParado = opcoes.velocidadeParadoKmh ?? 3;
  const duracaoMinimaMs = (opcoes.duracaoMinimaParadaMin ?? 5) * 60_000;
  const raio = opcoes.raioParadaM ?? 60;

  const ordenados = [...pontos]
    .filter((p) => !Number.isNaN(Date.parse(p.em)))
    .sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  if (ordenados.length < 2) return [];

  const segmentos: Segmento[] = [];
  let emMovimento: PontoNoTempo[] = [];

  const fecharMovimento = () => {
    if (emMovimento.length < 2) {
      emMovimento = [];
      return;
    }
    const velocidades = emMovimento.map((p) => p.velocidadeKmh).filter((v): v is number => v != null);
    segmentos.push({
      tipo: "deslocamento",
      de: emMovimento[0]!.em,
      ate: emMovimento[emMovimento.length - 1]!.em,
      distanciaMetros: Math.round(distanciaTotalMetros(emMovimento)),
      velocidadeMaxKmh: velocidades.length ? Math.round(Math.max(...velocidades)) : null,
    });
    emMovimento = [];
  };

  let i = 0;
  while (i < ordenados.length) {
    const ancora = ordenados[i]!;
    // Estende enquanto o ponto continuar dentro do raio da ancora E lento.
    let j = i;
    while (j + 1 < ordenados.length) {
      const proximo = ordenados[j + 1]!;
      const rapido = (proximo.velocidadeKmh ?? 0) > velocidadeParado;
      if (rapido || haversineMetros(ancora, proximo) > raio) break;
      j++;
    }

    const duracao = Date.parse(ordenados[j]!.em) - Date.parse(ancora.em);
    if (j > i && duracao >= duracaoMinimaMs) {
      fecharMovimento();
      const doTrecho = ordenados.slice(i, j + 1);
      segmentos.push({
        tipo: "parada",
        de: ancora.em,
        ate: ordenados[j]!.em,
        duracaoMin: Math.round(duracao / 60_000),
        // Centroide, e nao a ancora: com o GPS tremendo, o centro do aglomerado
        // fica mais perto de onde o carro realmente estava.
        lat: doTrecho.reduce((s, p) => s + p.lat, 0) / doTrecho.length,
        lng: doTrecho.reduce((s, p) => s + p.lng, 0) / doTrecho.length,
      });
      i = j + 1;
      continue;
    }

    // Nao deu parada: este ponto e movimento. O proximo laco reavalia a partir
    // do seguinte — assim uma parada que comeca no meio de um aglomerado curto
    // ainda e encontrada.
    emMovimento.push(ancora);
    i++;
  }
  fecharMovimento();

  return segmentos;
}
