import type {
  PontoHistorico,
  RastreadorConnector,
  RastreadorCredenciais,
  ResultadoHistorico,
  ResultadoPosicao,
  ResultadoResumoDia,
  ResultadoStatus,
  StatusRastreador,
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
   * Cada campo comeca `null` e SO vira booleano se o nome apareceu. E o que
   * separa "o GPS esta sem fix" de "o aparelho nao contou".
   */
  function lerStatuses(bruto: unknown): StatusRastreador | null {
    if (!bruto || typeof bruto !== "object") return null;
    const r = bruto as { trackerId?: unknown; statuses?: unknown };
    if (r.trackerId == null) return null;

    const item: StatusRastreador = {
      identificadorExterno: String(r.trackerId),
      comunicando: null,
      rastreando: null,
      movendo: null,
      ignicao: null,
      bateriaPct: null,
    };

    for (const s of Array.isArray(r.statuses) ? r.statuses : []) {
      if (!s || typeof s !== "object") continue;
      const { name, status } = s as { name?: unknown; status?: unknown };
      const valor = typeof status === "string" ? status.toUpperCase() : "";
      switch (name) {
        case "COMMUNICATION":
          item.comunicando = valor === "UP" || valor === "TRUE";
          break;
        case "TRACKING":
          item.rastreando = valor === "ON" || valor === "TRUE";
          break;
        case "MOVEMENT":
          item.movendo = valor === "MOVING";
          break;
        case "ACC":
          item.ignicao = valor === "ON" || valor === "TRUE";
          break;
        case "BAT":
          item.bateriaPct = comoNumero(status);
          break;
        default:
          break; // CUT e o que mais vier: ignorado sem quebrar.
      }
    }
    return item;
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

    async ultimaPosicao(id: string): Promise<ResultadoPosicao> {
      try {
        const d = (await buscar(`/trackers/${encodeURIComponent(id)}/last-location`)) as {
          latitude?: unknown;
          longitude?: unknown;
          time?: unknown;
          speed?: unknown;
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

        return {
          tipo: "posicao",
          lat,
          lng,
          registradoEm: new Date(em).toISOString(),
          velocidadeKmh: comoNumero(d.speed),
        };
      } catch (e) {
        return { tipo: "indeterminado", motivo: motivo(e) };
      }
    },

    async historico(id, inicioIso, fimIso, opcoes): Promise<ResultadoHistorico> {
      const distancia = opcoes?.distanciaM ?? 100;
      const precisao = opcoes?.precisao ?? "medium";
      const trecho = fimIso ? `/${encodeURIComponent(fimIso)}` : "";
      try {
        const d = await buscar(
          `/trackers/${encodeURIComponent(id)}/history/${encodeURIComponent(inicioIso)}${trecho}` +
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
        const d = await buscar(`/trackers/${encodeURIComponent(id)}/day-summary/${encodeURIComponent(dataInicio)}${trecho}`);
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
