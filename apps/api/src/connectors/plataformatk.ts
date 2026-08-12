import {
  bateriaPct,
  bloqueado,
  comunicando,
  ignicao,
  lerSensores,
  movendo,
  rastreando,
  type CadastroRastreador,
  type PontoHistorico,
  type RastreadorConnector,
  type RastreadorCredenciais,
  type ResultadoCadastro,
  type ResultadoDicionario,
  type ResultadoHistorico,
  type ResultadoPosicao,
  type ResultadoResumoDia,
  type ResultadoStatus,
  type StatusRastreador,
} from "@isphub/shared";

/**
 * Conector da PlataformaTK.
 *
 * Mesmo formato do `connectors/sgp.ts`: fabrica que devolve objeto literal,
 * classe de erro privada, embrulhos de transporte com timeout, e NENHUM acesso
 * a banco — quem persiste e o service.
 *
 * O contrato esta documentado em `@isphub/shared/rastreamento`, conferido
 * contra a API de producao. O ponto mais importante: `statuses` e um ARRAY de
 * `{name, status}`, e um rastreador offline manda so o COMMUNICATION.
 */

const TIMEOUT_MS = 10_000;
const TENTATIVAS = 3;

class PlataformaTkError extends Error {
  status?: number;
  constructor(mensagem: string, status?: number) {
    super(mensagem);
    this.name = "PlataformaTkError";
    this.status = status;
  }
}

/**
 * Log so da ORIGEM, nunca da URL inteira e jamais do header.
 *
 * Aqui a credencial vai no header (nao na query, como no SGP), entao a URL e
 * menos perigosa — mas o id do rastreador ainda e dado do cliente, e a
 * disciplina custa nada.
 */
function origemSegura(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "url-invalida";
  }
}

function dorme(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A data no formato que a PlataformaTK de fato aceita: `2019-01-15T061100Z`,
 * COMPACTO, sem os dois-pontos.
 *
 * Nao e capricho, e a diferenca entre a rota existir ou nao. `encodeURIComponent`
 * de um ISO normal produz `2026-08-08T00%3A00%3A00Z`, e o roteador deles nao
 * casa com isso — devolve **404**, que se le como "esse rastreador nao tem
 * historico". Com a forma compacta a rota CASA, e ai o servidor deles responde
 * **500**. Foi o que confundiu o diagnostico por duas sessoes: 404 parecia dado
 * ausente quando era URL errada, e a URL certa revela o problema verdadeiro, que
 * e do outro lado.
 *
 * O formato sai do unico exemplo executavel da documentacao do fornecedor:
 *   /trackers/81688/history/2019-01-15T061100Z?distance=200&accuracy=medium
 */
export function dataCompactaPtk(iso: string): string {
  // Os hifens da DATA ficam; so os dois-pontos da HORA saem. Conferido contra a
  // API de producao: `2026-08-11T000000Z` casa (500), `20260811T000000Z` nao
  // (404). Os milissegundos tambem precisam sair — `toISOString()` os inclui.
  return iso.replace(/\.\d+/, "").replace(/(T\d{2}):(\d{2}):(\d{2})/, "$1$2$3");
}

export function createPlataformaTkConnector(creds: RastreadorCredenciais): RastreadorConnector {
  const base = creds.baseUrl.replace(/\/+$/, "");

  async function buscar(caminho: string): Promise<unknown> {
    const url = `${base}${caminho}`;
    let ultimoErro: unknown;

    for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
      // Backoff 1s, 2s. So ENTRE tentativas — a primeira sai na hora.
      if (tentativa > 0) await dorme(500 * 2 ** tentativa);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `AuthDevice ${creds.chave}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const texto = await res.text();
        if (!res.ok) {
          /*
           * 4xx nao melhora com repeticao: id que nao existe (400) ou chave
           * errada (401) vao falhar igual nas proximas duas. Repetir so gasta
           * o orcamento de requisicoes contra o teto do fornecedor.
           */
          const erro = new PlataformaTkError(`PTK ${res.status} em ${origemSegura(url)}`, res.status);
          if (res.status >= 400 && res.status < 500) throw erro;
          ultimoErro = erro;
          continue;
        }
        if (!texto.trim()) return null;
        try {
          return JSON.parse(texto);
        } catch {
          throw new PlataformaTkError(`PTK devolveu corpo nao-JSON em ${origemSegura(url)}`, res.status);
        }
      } catch (e) {
        ultimoErro = e;
        /*
         * Timeout NAO e retentado: a requisicao pode ter sido servida do outro
         * lado, e repetir so empilha carga em cima de um servico ja lento.
         * Mesma regra da integracao de referencia — essa parte ela acertou.
         */
        if (e instanceof Error && e.name === "TimeoutError") break;
        if (e instanceof PlataformaTkError && e.status && e.status < 500) break;
      }
    }
    throw ultimoErro ?? new PlataformaTkError("PTK: falha desconhecida");
  }

  /** Mensagem curta pro campo `motivo` — nunca inclui a chave. */
  function motivo(e: unknown): string {
    if (e instanceof PlataformaTkError) return e.message;
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    return "falha desconhecida";
  }

  function comoNumero(v: unknown): number | null {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  }

  /**
   * Converte o array `statuses` no nosso registro.
   *
   * O conector NAO interpreta sensor: ele guarda o mapa cru e delega a leitura
   * as funcoes de `sensores.ts`. Antes havia um `switch` aqui com um `case` por
   * sensor conhecido e um `default: break` que ENGOLIA o resto — foi assim que
   * o `CUT` (bloqueio do veiculo) ficou fora do sistema mesmo chegando em toda
   * resposta.
   *
   * Com o mapa, sensor novo do fornecedor entra sozinho; e a decisao de o que
   * cada valor significa mora num lugar so, compartilhado com a web.
   */
  function lerStatuses(bruto: unknown): StatusRastreador | null {
    if (!bruto || typeof bruto !== "object") return null;
    const r = bruto as { trackerId?: unknown; statuses?: unknown };
    if (r.trackerId == null) return null;

    const sensores = lerSensores(
      (Array.isArray(r.statuses) ? r.statuses : []).filter(
        (s): s is { name: string; status: string } =>
          !!s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string",
      ),
    );

    return {
      identificadorExterno: String(r.trackerId),
      sensores,
      comunicando: comunicando(sensores),
      rastreando: rastreando(sensores),
      movendo: movendo(sensores),
      ignicao: ignicao(sensores),
      bateriaPct: bateriaPct(sensores),
      bloqueado: bloqueado(sensores),
    };
  }

  /**
   * Cadastro do aparelho (`GET /trackers`).
   *
   * Os nomes de campo abaixo foram lidos da resposta REAL da API de producao —
   * `trackerModelName`, `trackingIntervalSeconds`, `hasCutCommands`,
   * `creationDate`. Nao sao um palpite razoavel: um palpite razoavel seria
   * `model`, `interval`, `hasCut`, `installationDate`, e os quatro dariam
   * `undefined` calado.
   *
   * ⚠️ SEGURANCA: esta resposta traz `password` — a senha SMS do rastreador, em
   * TEXTO PURO —, alem de `imei`, `phoneNumber` e `apnPassword`. Nenhum dos
   * quatro e lido aqui, de proposito: nao temos uso para eles, e guarda-los so
   * criaria um vazamento a espera de acontecer.
   *
   * `isBlocked` tambem fica de fora: nao da pra saber pela resposta se e o
   * veiculo bloqueado ou a conta do aparelho suspensa, e o bloqueio do veiculo
   * ja vem pelo sensor `CUT`, que e inequivoco.
   */
  function lerCadastro(bruto: unknown): CadastroRastreador | null {
    if (!bruto || typeof bruto !== "object") return null;
    const r = bruto as Record<string, unknown>;
    if (r.trackerId == null) return null;
    const criado = typeof r.creationDate === "string" ? Date.parse(r.creationDate) : NaN;
    return {
      identificadorExterno: String(r.trackerId),
      modelo: typeof r.trackerModelName === "string" ? r.trackerModelName.slice(0, 60) : null,
      nome: typeof r.name === "string" ? r.name.slice(0, 120) : null,
      intervaloSegundos: comoNumero(r.trackingIntervalSeconds),
      temComandoCorte: r.hasCutCommands === true,
      instaladoEm: Number.isNaN(criado) ? null : new Date(criado).toISOString(),
    };
  }

  return {
    async testarConexao() {
      try {
        await buscar("/trackers/status");
        return { ok: true };
      } catch (e) {
        return { ok: false, mensagem: motivo(e) };
      }
    },

    async statusDeTodos(): Promise<ResultadoStatus> {
      try {
        const dados = await buscar("/trackers/status");
        if (!Array.isArray(dados)) {
          return { tipo: "indeterminado", motivo: "PTK: /trackers/status nao devolveu lista" };
        }
        return { tipo: "lista", itens: dados.map(lerStatuses).filter((i): i is StatusRastreador => i !== null) };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },

    async cadastroDeTodos(): Promise<ResultadoCadastro> {
      try {
        const dados = await buscar("/trackers");
        if (!Array.isArray(dados)) {
          return { tipo: "indeterminado", motivo: "PTK: /trackers nao devolveu lista" };
        }
        return { tipo: "lista", itens: dados.map(lerCadastro).filter((i): i is CadastroRastreador => i !== null) };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },

    async dicionarioDeSensores(): Promise<ResultadoDicionario> {
      try {
        const dados = await buscar("/status-descriptions");
        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
          return { tipo: "indeterminado", motivo: "PTK: /status-descriptions nao devolveu objeto" };
        }
        return { tipo: "dicionario", dados };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },

    async ultimaPosicao(id: string): Promise<ResultadoPosicao> {
      try {
        const d = (await buscar(`/trackers/${encodeURIComponent(id)}/last-location`)) as {
          latitude?: unknown;
          longitude?: unknown;
          time?: unknown;
          speed?: unknown;
          lastCommunication?: unknown;
        } | null;

        // Corpo vazio: o fornecedor respondeu e nao tem posicao. Prova positiva.
        if (!d) return { tipo: "sem_posicao" };

        const lat = comoNumero(d.latitude);
        const lng = comoNumero(d.longitude);
        if (lat === null || lng === null) return { tipo: "sem_posicao" };

        const em = typeof d.time === "string" ? Date.parse(d.time) : Number.NaN;
        if (Number.isNaN(em)) {
          // Ponto sem carimbo confiavel nao serve: `registradoEm` e a chave
          // natural da serie, e um "agora" inventado quebraria a idempotencia.
          return { tipo: "indeterminado", motivo: "PTK: last-location sem `time` valido" };
        }

        /*
         * `lastCommunication` e OUTRO relogio, e nao um sinonimo de `time`: ele
         * diz quando o aparelho falou, `time` diz quando ele conseguiu
         * coordenada. Um rastreador em garagem mantem o radio vivo e repete a
         * ultima posicao — o mapa mostra o carro num lugar onde ele nao esta, e
         * nenhum `ficou_offline` dispara porque o COMMUNICATION segue UP.
         */
        const comunicou = typeof d.lastCommunication === "string" ? Date.parse(d.lastCommunication) : Number.NaN;

        return {
          tipo: "posicao",
          lat,
          lng,
          registradoEm: new Date(em).toISOString(),
          velocidadeKmh: comoNumero(d.speed),
          comunicouEm: Number.isNaN(comunicou) ? null : new Date(comunicou).toISOString(),
        };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },

    async historico(id, inicioIso, fimIso, opcoes): Promise<ResultadoHistorico> {
      const distancia = opcoes?.distanciaM ?? 100;
      const precisao = opcoes?.precisao ?? "medium";
      const trecho = fimIso ? `/${dataCompactaPtk(fimIso)}` : "";
      try {
        const d = await buscar(
          `/trackers/${encodeURIComponent(id)}/history/${dataCompactaPtk(inicioIso)}${trecho}` +
            `?distance=${distancia}&accuracy=${precisao}`,
        );
        if (!Array.isArray(d)) return { tipo: "trecho", pontos: [] };
        const pontos: PontoHistorico[] = [];
        for (const p of d) {
          const lat = comoNumero((p as { latitude?: unknown }).latitude);
          const lng = comoNumero((p as { longitude?: unknown }).longitude);
          const bruto = (p as { timestamp?: unknown; time?: unknown }).timestamp ?? (p as { time?: unknown }).time;
          const t = typeof bruto === "string" ? Date.parse(bruto) : Number.NaN;
          if (lat === null || lng === null || Number.isNaN(t)) continue;
          pontos.push({
            lat,
            lng,
            registradoEm: new Date(t).toISOString(),
            velocidadeKmh: comoNumero((p as { speed?: unknown }).speed),
          });
        }
        return { tipo: "trecho", pontos };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },

    async resumoDeDias(id, dataInicio, dataFim): Promise<ResultadoResumoDia> {
      const trecho = dataFim ? `/${encodeURIComponent(dataFim)}` : "";
      try {
        const d = await buscar(`/trackers/${encodeURIComponent(id)}/day-summary/${dataInicio}${trecho}`);
        const lista = Array.isArray(d) ? d : d ? [d] : [];
        return {
          tipo: "resumo",
          dias: lista.map((r) => {
            const o = r as { date?: unknown; distance?: unknown; maxSpeed?: unknown; trackerName?: unknown };
            return {
              data: String(o.date ?? ""),
              // METROS. O fornecedor manda em metros e o nome do campo diz isso
              // — a integracao de referencia divide por 1000 inline, e um /1000
              // esquecido vira relatorio mil vezes errado sem parecer errado.
              distanciaMetros: comoNumero(o.distance) ?? 0,
              velocidadeMaximaKmh: comoNumero(o.maxSpeed),
              apelidoRastreador: typeof o.trackerName === "string" ? o.trackerName : null,
            };
          }),
        };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },
  };
}
