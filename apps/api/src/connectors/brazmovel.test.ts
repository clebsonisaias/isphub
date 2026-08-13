import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bytesParaGb,
  cpfValido,
  formatarMsisdn,
  marcaComercial,
  mascararNumero,
  nomesConferem,
  percentualConsumido,
} from "@isphub/shared";
import { createBrazmovelConnector, removerCamposInternos } from "./brazmovel.js";

/**
 * O conector Brazmovel.
 *
 * Os shapes daqui foram conferidos contra a API de PRODUCAO nesta sessao — nao
 * saem de documentacao. Os testes abaixo travam as decisoes que sao invisiveis
 * na leitura do codigo e caras de descobrir em producao.
 */

const CREDS = { url: "https://api.brazmovel.com.br/v1", token: "token-de-teste" };

/** Responde por rota, e registra o que foi chamado. */
function mockarFetch(rotas: Record<string, { status?: number; body?: unknown }>) {
  const chamadas: string[] = [];
  const fn = vi.fn(async (url: string | URL) => {
    const u = String(url);
    chamadas.push(u);
    const chave = Object.keys(rotas).find((k) => u.includes(k));
    if (!chave) return new Response("{}", { status: 404 });
    const { status = 200, body = {} } = rotas[chave]!;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return { chamadas, fn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Uma resposta de plano no formato REAL da Brazmovel, com o preco de atacado
// dentro — e ele que nao pode sobreviver ate a saida.
const PLANO_REAL = {
  count: 1,
  items: [
    {
      id: "787b2c56",
      recurring: true,
      startDate: "2026-08-12T14:06:53.351Z",
      endDate: "2026-09-12T14:06:58.460Z",
      status: "ACTIVE",
      paymentMethod: "INTEGRATION",
      lineId: "linha-1",
      product: {
        id: "a43fee19",
        title: "Braz Móvel 20GB",
        subtitle: "20GB de dados + ligações e SMS",
        price: 3000,
        cicle: 31,
        status: "ACTIVE",
      },
    },
  ],
};

describe("o que NUNCA pode sair do conector", () => {
  it("nenhum campo interno sobrevive — nem aninhado, nem dentro de array", () => {
    const cru = {
      msisdn: "5584988102532",
      iccid: "8955170112345678901",
      imsi: "724119999",
      customer: { name: "Fulano", cpf: "12345678909", birthdate: "1990-01-01" },
      planos: [{ product: { title: "20GB", price: 3000 } }, { product: { title: "10GB" } }],
      parceiro: { balance: 31000, comission: 200, cnpj: "67506603000130" },
    };
    const texto = JSON.stringify(removerCamposInternos(cru));

    for (const proibido of [
      "iccid",
      "imsi",
      "price",
      "3000",
      "cpf",
      "12345678909",
      "birthdate",
      "balance",
      "31000",
      "comission",
      "cnpj",
    ]) {
      expect(texto, `vazou "${proibido}"`).not.toContain(proibido);
    }
    // ...e o que É para passar continua passando.
    expect(texto).toContain("20GB");
    expect(texto).toContain("5584988102532");
  });

  it("o preço de atacado não chega na linha consultada", async () => {
    mockarFetch({
      "/line/linha-1/plan": { body: PLANO_REAL },
      "/line/linha-1/usage": { body: { remaining: 8_000_000_000, total: 20_000_000_000, types: [] } },
      "/line/linha-1": { body: { id: "linha-1", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    const linha = await createBrazmovelConnector(CREDS).consultarLinha("linha-1");
    const texto = JSON.stringify(linha);

    // `price: 3000` e o que a CITmax PAGA. O chip do tecnico e corporativo, entao
    // qualquer valor na tela seria o custo da empresa — nao existe versao de
    // varejo para por no lugar.
    expect(texto).not.toContain("3000");
    expect(texto).not.toContain("price");
    expect(linha?.plano?.nome).toBe("CITmóvel 20GB");
  });

  it("a marca do atacadista não chega ao técnico", async () => {
    mockarFetch({
      "/line/l/plan": { body: PLANO_REAL },
      "/line/l/usage": { body: { remaining: 0, total: 0, types: [] } },
      "/line/l": { body: { id: "l", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    const linha = await createBrazmovelConnector(CREDS).consultarLinha("l");

    // Quem vende a linha para o tecnico e a CITmax; "Brazmóvel" e o atacadista.
    expect(JSON.stringify(linha)).not.toMatch(/braz/i);
  });
});

describe("marca comercial", () => {
  it("troca as variações que a operadora usa", () => {
    // O catalogo deles muda sem aviso, e um plano novo escrito diferente
    // reintroduziria a marca errada em silencio.
    expect(marcaComercial("Braz Móvel 20GB")).toBe("CITmóvel 20GB");
    expect(marcaComercial("Braz Movel 10GB")).toBe("CITmóvel 10GB");
    expect(marcaComercial("Brazmóvel Controle")).toBe("CITmóvel Controle");
    expect(marcaComercial("BRAZ MÓVEL 5GB")).toBe("CITmóvel 5GB");
    expect(marcaComercial("brazmovel")).toBe("CITmóvel");
  });

  it("não mexe no que não é a marca", () => {
    expect(marcaComercial("Plano 20GB + ligações")).toBe("Plano 20GB + ligações");
    expect(marcaComercial(null)).toBe("");
  });
});

describe("linha em ativação (PRE_ACTIVE)", () => {
  it("esconde o número e não gasta chamada em consumo nem plano", async () => {
    const { chamadas } = mockarFetch({
      "/line/linha-x": { body: { id: "linha-x", msisdn: "5584911112222", status: "PRE_ACTIVE" } },
    });
    const linha = await createBrazmovelConnector(CREDS).consultarLinha("linha-x");

    // Nesse estado a operadora devolve msisdn ALEATORIO — mostrar seria mostrar
    // o numero errado com cara de certo.
    expect(linha?.numero).toBeNull();
    expect(linha?.emAtivacao).toBe(true);
    expect(linha?.statusRotulo).toBe("Em ativação");
    expect(chamadas).toHaveLength(1);
    expect(chamadas.some((c) => c.includes("/usage"))).toBe(false);
  });
});

describe("o plano ativo", () => {
  it("é pedido com status=ACTIVE, e não pescado de uma lista paginada", async () => {
    const { chamadas } = mockarFetch({
      "/line/linha-1/plan": { body: PLANO_REAL },
      "/line/linha-1/usage": { body: { remaining: 0, total: 20_000_000_000, types: [] } },
      "/line/linha-1": { body: { id: "linha-1", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    await createBrazmovelConnector(CREDS).consultarLinha("linha-1");

    /*
     * Sem o filtro, a resposta e paginada e o fallback `itens[0]` pega um plano
     * EXPIRADO numa linha com muitas renovacoes — e o `endDate` dele vira
     * "renova em", uma data no passado com cara de futuro. Um refactor que
     * "simplifique" tirando a query reintroduz o bug sem quebrar mais nada.
     */
    expect(chamadas.some((c) => c.includes("/plan?status=ACTIVE"))).toBe(true);
  });

  it("busca só o plano corrente — planos anteriores não são consultados", async () => {
    const { chamadas } = mockarFetch({
      "/line/linha-1/plan": { body: PLANO_REAL },
      "/line/linha-1/usage": { body: { remaining: 0, total: 0, types: [] } },
      "/line/linha-1": { body: { id: "linha-1", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    await createBrazmovelConnector(CREDS).consultarLinha("linha-1");

    // Uma chamada so, e com o filtro: o historico saiu do produto, entao a
    // listagem paginada nao deve voltar "de brinde" num refactor futuro.
    const chamadasDePlano = chamadas.filter((c) => c.includes("/plan"));
    expect(chamadasDePlano).toHaveLength(1);
    expect(chamadasDePlano[0]).toContain("status=ACTIVE");
  });
});

describe("franquia ausente x franquia esgotada x consulta falhou", () => {
  it("linha ativa SEM plano não vira barra de consumo", async () => {
    // Caso real: a linha do tecnico de teste responde exatamente isto.
    mockarFetch({
      "/line/l/plan": { body: { count: 0, items: [] } },
      "/line/l/usage": { body: { remaining: 0, total: 0, types: [] } },
      "/line/l": { body: { id: "l", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    const linha = await createBrazmovelConnector(CREDS).consultarLinha("l");

    // `total: 0` com zero categorias significa "nao ha pacote contratado".
    // Devolver isso como consumo faria a tela desenhar uma barra cheia, e o
    // tecnico leria "franquia esgotada".
    expect(linha?.consumo).toBeUndefined();
    expect(linha?.plano).toBeUndefined();
    expect(linha?.consumoIndisponivel).toBeUndefined();
    expect(linha?.statusRotulo).toBe("Ativa");
  });

  it("franquia realmente zerada continua sendo mostrada", async () => {
    mockarFetch({
      "/line/l/plan": { body: PLANO_REAL },
      "/line/l/usage": { body: { remaining: 0, total: 20_000_000_000, types: [] } },
      "/line/l": { body: { id: "l", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    const linha = await createBrazmovelConnector(CREDS).consultarLinha("l");
    expect(linha?.consumo).toEqual({ restanteGb: 0, totalGb: 20, categorias: [] });
  });

  it("falha ao consultar NÃO é 0 GB — é 'não consegui perguntar'", async () => {
    mockarFetch({
      "/line/l/plan": { status: 500, body: { message: "boom" } },
      "/line/l/usage": { status: 500, body: { message: "boom" } },
      "/line/l": { body: { id: "l", msisdn: "5584988102532", status: "ACTIVE" } },
    });
    const linha = await createBrazmovelConnector(CREDS).consultarLinha("l");

    // A distincao inteira da tela mora aqui: sem ela, uma queda de rede vira
    // "0 GB restantes" e o tecnico conclui que a franquia acabou.
    expect(linha?.consumoIndisponivel).toBe(true);
    expect(linha?.consumo).toBeUndefined();
    expect(linha?.numero).toBe("(84) 98810-2532");
  });
});

describe("teste de conexão", () => {
  it("404 em CPF inexistente é SUCESSO — prova que o token vale", async () => {
    // Conferido na API real: CPF valido e inexistente -> 404; token ruim -> 401.
    mockarFetch({ "/customer/cpf/": { status: 404, body: {} } });
    const r = await createBrazmovelConnector(CREDS).testarConexao();
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(404);
  });

  it("401 diz que o token foi recusado, não 'erro ao testar'", async () => {
    mockarFetch({ "/customer/cpf/": { status: 401, body: { message: "Unauthorized" } } });
    const r = await createBrazmovelConnector(CREDS).testarConexao();
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(401);
    // Distinguir os dois e o ponto: senao o admin fica trocando um token bom.
    expect(r.detalhe).toBe("Token recusado pela Brazmóvel");
  });

  it("não usa GET /me — o endpoint carrega saldo e comissão da CITmax", async () => {
    const { chamadas } = mockarFetch({ "/customer/cpf/": { status: 404, body: {} } });
    await createBrazmovelConnector(CREDS).testarConexao();
    expect(chamadas.some((c) => c.endsWith("/me"))).toBe(false);
  });
});

describe("candidatas por CPF (a tela de vínculo do admin)", () => {
  it("devolve só o mínimo para reconhecer a linha", async () => {
    mockarFetch({
      "/customer/cpf/": {
        body: {
          name: "JOAO VITOR DO NASCIMENTO SOUZA",
          cpf: "12364535492",
          email: "x@y.com",
          lines: [{ id: "linha-1", msisdn: "5584988104309", status: "ACTIVE", iccid: "8955" }],
        },
      },
    });
    const r = await createBrazmovelConnector(CREDS).candidatasPorCpf("123.645.354-92");

    // O admin precisa reconhecer a linha do funcionario, nao ficar com o numero
    // de um terceiro anotado.
    expect(r.linhas).toEqual([
      { lineId: "linha-1", numeroMascarado: "(84) *****-4309", statusRotulo: "Ativa" },
    ]);
    // O nome sai para ser COMPARADO com o do cadastro — a rota nunca o exibe.
    expect(r.nomeTitular).toBe("JOAO VITOR DO NASCIMENTO SOUZA");
  });

  it("recusa CPF inválido antes de gastar uma chamada", async () => {
    const { chamadas } = mockarFetch({ "/customer/cpf/": { body: {} } });
    await expect(createBrazmovelConnector(CREDS).candidatasPorCpf("111.111.111-11")).rejects.toThrow(
      /CPF inválido/,
    );
    expect(chamadas).toHaveLength(0);
  });
});

describe("aritmética que erra em silêncio", () => {
  it("bytes viram GB decimais, não binários", () => {
    // 1024³ faria um plano de 20 GB aparecer como 18,6 GB — ninguem reporta
    // isso como bug, so desconfia do sistema.
    expect(bytesParaGb(20_000_000_000)).toBe(20);
    expect(bytesParaGb(8_500_000_000)).toBe(8.5);
    expect(bytesParaGb(0)).toBe(0);
    expect(bytesParaGb(null)).toBe(0);
    expect(bytesParaGb(-5)).toBe(0);
  });

  it("formata o msisdn e descarta comprimento estranho", () => {
    expect(formatarMsisdn("5584988102532")).toBe("(84) 98810-2532");
    expect(formatarMsisdn("84988102532")).toBe("(84) 98810-2532");
    expect(formatarMsisdn("8433334444")).toBe("(84) 3333-4444");
    expect(formatarMsisdn("123")).toBeNull();
    expect(formatarMsisdn(null)).toBeNull();
  });

  it("mascara preservando DDD e os quatro últimos", () => {
    expect(mascararNumero("(84) 98810-2532")).toBe("(84) *****-2532");
    expect(mascararNumero(null)).toBeNull();
  });

  it("percentual consumido é null quando não há franquia", () => {
    expect(percentualConsumido(8, 20)).toBe(60);
    expect(percentualConsumido(0, 20)).toBe(100);
    // Sem franquia nao ha percentual — e nao e 0% nem 100%.
    expect(percentualConsumido(0, 0)).toBeNull();
  });

  it("valida os dígitos do CPF", () => {
    expect(cpfValido("123.645.354-92")).toBe(true);
    expect(cpfValido("12345678909")).toBe(true);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("12345678900")).toBe(false);
    expect(cpfValido("123")).toBe(false);
  });

  it("compara nomes tolerando acento, caixa e nome do meio", () => {
    // Defesa contra o CPF digitado errado: um digito trocado produz uma tela
    // que FUNCIONA, mostrando a linha de um estranho.
    expect(nomesConferem("João Vitor do Nascimento Souza", "JOAO VITOR DO NASCIMENTO SOUZA")).toBe(
      true,
    );
    expect(nomesConferem("João V. N. Souza", "JOAO VITOR DO NASCIMENTO SOUZA")).toBe(true);
    expect(nomesConferem("João Vitor Souza", "MARIA APARECIDA SILVA")).toBe(false);
    expect(nomesConferem("", "JOAO")).toBe(false);
  });
});
