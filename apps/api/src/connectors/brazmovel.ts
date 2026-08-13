import {
  bytesParaGb,
  cpfValido,
  formatarMsisdn,
  marcaComercial,
  mascararNumero,
  rotuloStatusLinha,
  rotuloStatusPlano,
  type BrazmovelConnector,
  type BrazmovelCredentials,
  type CategoriaConsumo,
  type ConsumoLinha,
  type LinhaCandidata,
  type LinhaMovel,
  type PlanoLinha,
  type TesteConexao,
} from "@isphub/shared";

/**
 * Conector Brazmovel (operadora movel da CITmax) — SO LEITURA.
 *
 * Portado do AtendeHub, com tres correcoes que so apareceram consultando a API
 * de producao nesta sessao. Estao marcadas com [CORRECAO] abaixo.
 *
 * O valor deste arquivo esta nas TRAVAS, nao na chamada HTTP:
 *
 *  - `CAMPOS_INTERNOS` remove, na saida, tudo que nunca pode chegar ao app.
 *  - Os shapes crus declaram so o que lemos — nao ha spread do objeto do
 *    fornecedor, entao um campo novo do lado deles nao vaza sozinho.
 *  - `PRE_ACTIVE` esconde o numero: nesse estado a operadora devolve msisdn e
 *    ICCID aleatorios.
 *
 * O token e do PARCEIRO e vale para a base INTEIRA da CITmax. Nada aqui decide
 * quem pode ver o que — quem decide e a rota, e a rota do tecnico nao aceita
 * parametro nenhum.
 */

const TIMEOUT_MS = 15_000;

/**
 * Campos que nunca saem do conector.
 *
 * Lista maior que a do AtendeHub porque aqui passamos por objetos `customer`
 * (que carregam PII do titular) e pelo `/me` (que carrega o saldo e a comissao
 * da CITmax). No AtendeHub so linhas atravessavam esta funcao.
 */
const CAMPOS_INTERNOS = new Set([
  // identificadores do chip
  "iccid",
  "imsi",
  "puk",
  "puk1",
  "puk2",
  "eid",
  "imei",
  // preco de ATACADO — o que a CITmax paga
  "price",
  "preco",
  // dados do parceiro (GET /me)
  "balance",
  "comission",
  "cnpj",
  // PII do titular
  "cpf",
  "birthdate",
  "address",
]);

/** Remove recursivamente campos internos de qualquer objeto/array. */
export function removerCamposInternos<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map((v) => removerCamposInternos(v)) as unknown as T;
  }
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (CAMPOS_INTERNOS.has(k)) continue;
      saida[k] = removerCamposInternos(v);
    }
    return saida as T;
  }
  return valor;
}

/**
 * "Consegui perguntar" x "nao consegui", separado de "a resposta veio vazia".
 *
 * Um `null` cru nao distingue as duas coisas, e a distincao e o ponto: `null`
 * significa "a linha nao tem plano/franquia" e a falha significa "a operadora
 * nao respondeu". Colapsar as duas faria uma queda de rede virar "0 GB
 * restantes" numa tela cujo proposito inteiro e dizer quanto sobrou.
 */
type Tentativa<T> = { ok: true; valor: T | null } | { ok: false };

function tentar<T>(p: Promise<T | null>): Promise<Tentativa<T>> {
  return p.then((valor) => ({ ok: true as const, valor })).catch(() => ({ ok: false as const }));
}

export class BrazmovelError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "BrazmovelError";
  }
}

export function createBrazmovelConnector(creds: BrazmovelCredentials): BrazmovelConnector {
  const base = creds.url.replace(/\/+$/, "");

  async function req<T>(path: string): Promise<{ status: number; dados: T | null }> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${creds.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // A mensagem do fetch nunca ecoa o header — o token nao pode ir para log.
      throw new BrazmovelError(
        err instanceof Error ? `Falha de conexão: ${err.message}` : "Falha de conexão",
        0,
      );
    }
    const txt = await res.text();
    let dados: unknown = null;
    try {
      dados = txt ? JSON.parse(txt) : null;
    } catch {
      dados = null;
    }
    if (!res.ok && res.status !== 404) {
      const msg =
        (dados as { message?: string })?.message ||
        (dados as { error?: string })?.error ||
        `Brazmóvel respondeu ${res.status}`;
      throw new BrazmovelError(msg, res.status);
    }
    return { status: res.status, dados: dados as T | null };
  }

  function normalizarConsumo(usage: RawUsage | null): ConsumoLinha | undefined {
    if (!usage) return undefined;
    const totalGb = bytesParaGb(usage.total);
    const categorias: CategoriaConsumo[] = (usage.types ?? []).map((t) => ({
      descricao: String(t.description ?? "Dados"),
      restanteGb: bytesParaGb(t.remaining),
      totalGb: bytesParaGb(t.total),
    }));
    // Franquia zero E sem categoria = a linha nao tem pacote, nao e "acabou".
    // Conferido contra a API: uma linha ACTIVE sem plano devolve
    // `{remaining:0,total:0,types:[]}`. Devolver isso como consumo faria a tela
    // desenhar uma barra cheia e o tecnico ler "franquia esgotada".
    if (totalGb <= 0 && categorias.length === 0) return undefined;
    return { restanteGb: bytesParaGb(usage.remaining), totalGb, categorias };
  }

  function normalizarPlano(item: RawPlanItem | null | undefined): PlanoLinha | undefined {
    const prod = item?.product;
    if (!prod?.title) return undefined;
    return {
      // "Braz Móvel 20GB" -> "CITmóvel 20GB". A marca do atacadista nao chega ao
      // tecnico; quem vende a linha para ele e a CITmax.
      nome: marcaComercial(prod.title),
      ...(prod.subtitle ? { descricao: marcaComercial(prod.subtitle) } : {}),
      status: String(item?.status ?? "DESCONHECIDO"),
      statusRotulo: rotuloStatusPlano(item?.status),
      inicioEm: item?.startDate ?? null,
      fimEm: item?.endDate ?? null,
      recorrente: item?.recurring === true,
    };
  }

  /** O envelope da Brazmovel e `{items, count}` — conferido na API real. */
  function itensDoPlano(resp: RawPlanResp | null): RawPlanItem[] {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    return resp.items ?? resp.results ?? [];
  }

  return {
    async testarConexao(): Promise<TesteConexao> {
      // [CORRECAO] O AtendeHub testa com `GET /me`, e a documentacao interna do
      // Maxxi registrava que /me da 401. Conferido contra a producao nesta
      // sessao: /me responde 200 com token bom e 401 com token ruim — o
      // registro estava desatualizado. Ainda assim sondamos por
      // `/customer/cpf/{inexistente}`, porque e o MESMO caminho que a feature
      // usa (mesmo header, mesma base, mesmo parser) e porque /me devolve o
      // saldo e a comissao da CITmax, que nao ha motivo para trafegar.
      //
      // Um CPF sintaticamente valido e inexistente devolve 404 — conferido.
      // Entao: 404/200 = credencial boa; 401/403 = credencial recusada.
      try {
        const r = await req<unknown>("/customer/cpf/12345678909");
        const ok = r.status === 404 || (r.status >= 200 && r.status < 300);
        return ok
          ? { ok: true, httpStatus: r.status }
          : { ok: false, httpStatus: r.status, detalhe: `HTTP ${r.status}` };
      } catch (err) {
        const status = err instanceof BrazmovelError ? err.status : null;
        // O status HTTP vai junto de proposito: daqui a seis meses, a diferenca
        // entre "401" e "timeout" e a diferenca entre 5 minutos e 2 horas de
        // investigacao.
        const detalhe =
          status === 401 || status === 403
            ? "Token recusado pela Brazmóvel"
            : status === 0
              ? "Não foi possível alcançar a Brazmóvel"
              : status && status >= 500
                ? "Brazmóvel indisponível no momento"
                : err instanceof BrazmovelError
                  ? err.message
                  : "Falha ao testar";
        return { ok: false, httpStatus: status, detalhe };
      }
    },

    async candidatasPorCpf(cpfEntrada) {
      const cpf = String(cpfEntrada ?? "").replace(/\D/g, "");
      if (!cpfValido(cpf)) throw new BrazmovelError("CPF inválido", 400);
      const { dados } = await req<RawCustomer>(`/customer/cpf/${encodeURIComponent(cpf)}`);
      const linhas: LinhaCandidata[] = (dados?.lines ?? []).slice(0, 5).map((l) => ({
        lineId: String(l.id ?? ""),
        // Em ativacao o msisdn e aleatorio — nao mascaramos lixo, escondemos.
        numeroMascarado:
          l.status === "PRE_ACTIVE" ? null : mascararNumero(formatarMsisdn(l.msisdn)),
        statusRotulo: rotuloStatusLinha(l.status),
      }));
      // O nome sai daqui para ser COMPARADO com o do cadastro, nunca exibido.
      return { nomeTitular: dados?.name ? String(dados.name) : null, linhas: linhas.filter((l) => l.lineId) };
    },

    async consultarLinha(lineId) {
      const id = encodeURIComponent(lineId);
      const { status, dados: linha } = await req<RawLinha>(`/line/${id}`);
      if (status === 404 || !linha) return null;

      const emAtivacao = linha.status === "PRE_ACTIVE";
      const base: LinhaMovel = {
        numero: emAtivacao ? null : formatarMsisdn(linha.msisdn),
        emAtivacao,
        status: String(linha.status ?? "DESCONHECIDO"),
        statusRotulo: rotuloStatusLinha(linha.status),
      };
      // Em ativacao nao ha consumo nem plano para consultar, e o que a API
      // devolveria seria de um chip ainda nao entregue.
      if (emAtivacao) return removerCamposInternos(base);

      // [CORRECAO] O plano ATIVO vem com `status=ACTIVE` explicito. O AtendeHub
      // pede a lista sem filtro e faz `find(ACTIVE) ?? itens[0]` — como a
      // resposta e paginada, numa linha com muitas renovacoes o fallback pega um
      // plano EXPIRADO e renderiza o `endDate` dele como "renova em", uma data
      // no passado com cara de futuro.
      const [usage, planoAtivo] = await Promise.all([
        tentar(req<RawUsage>(`/line/${id}/usage`).then((r) => r.dados)),
        tentar(req<RawPlanResp>(`/line/${id}/plan?status=ACTIVE`).then((r) => r.dados)),
      ]);

      const indisponivel = !usage.ok || !planoAtivo.ok;
      const consumo = usage.ok ? normalizarConsumo(usage.valor) : undefined;
      const plano = planoAtivo.ok ? normalizarPlano(itensDoPlano(planoAtivo.valor)[0]) : undefined;

      return removerCamposInternos({
        ...base,
        ...(plano ? { plano } : {}),
        ...(consumo ? { consumo } : {}),
        ...(indisponivel ? { consumoIndisponivel: true } : {}),
      });
    },
  };
}

// Shapes crus da Brazmovel — SO o que lemos. Conferidos contra a API real.
interface RawLinha {
  id?: string;
  msisdn?: string;
  status?: string;
  type?: string;
}
interface RawCustomer {
  id?: string;
  name?: string;
  status?: string;
  lines?: RawLinha[];
}
interface RawUsage {
  remaining?: number;
  total?: number;
  types?: Array<{ description?: string; remaining?: number; total?: number }>;
}
interface RawPlanItem {
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  recurring?: boolean;
  product?: { title?: string; subtitle?: string };
}
interface RawPlanResp {
  items?: RawPlanItem[];
  results?: RawPlanItem[];
  count?: number;
}
