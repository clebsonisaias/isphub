import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSgpConnector } from "./sgp.js";

const creds = { url: "https://sgp.exemplo.com.br", app: "isphub", token: "tok-abc123" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createSgpConnector", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("testConnection retorna ok quando o catalogo de tipos responde 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ codigo: "1", descricao: "Sem conexao" }]));

    const conn = createSgpConnector(creds);
    const resultado = await conn.testConnection();

    expect(resultado.ok).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/ocorrencia/tipo/list/");
    expect(String(url)).toContain(`app=${creds.app}`);
    expect((options.headers as Record<string, string>).Authorization).toBe(`Token ${creds.token}`);
  });

  it("testConnection retorna ok:false quando o SGP responde erro (incluindo o fallback de token na query)", async () => {
    // sgpGet tenta token no header primeiro; em 401/403 refaz com token na query.
    // Aqui simulamos credenciais realmente invalidas: as duas tentativas falham.
    fetchMock
      .mockResolvedValueOnce(new Response("credenciais invalidas", { status: 401 }))
      .mockResolvedValueOnce(new Response("credenciais invalidas", { status: 401 }));

    const conn = createSgpConnector(creds);
    const resultado = await conn.testConnection();

    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("401");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("listOsTypes normaliza codigo/descricao a partir de um array bruto", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { codigo: "1", descricao: "Sem conexao" },
        { codigo: "2", descricao: "Instalacao nova" },
      ]),
    );

    const conn = createSgpConnector(creds);
    const tipos = await conn.listOsTypes();

    expect(tipos).toEqual([
      { sgpCodigo: "1", descricao: "Sem conexao" },
      { sgpCodigo: "2", descricao: "Instalacao nova" },
    ]);
  });

  it("listServiceOrders normaliza campos, endereco e lat/lng a partir de endereco_ll", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        paginacao: { total: 1 },
        ordens_servicos: [
          {
            os_id: "555",
            os_status: 0,
            motivo: "1",
            os_conteudo: "Cliente sem sinal",
            cliente_nome: "Maria Silva",
            contrato_id: "999",
            endereco_logradouro: "Rua das Flores",
            endereco_numero: "123",
            endereco_bairro: "Centro",
            endereco_cidade: "Natal",
            endereco_ll: "-5.79448,-35.211",
            os_data_agendamento: "2026-07-25 09:00:00",
            os_tecnico_responsavel_id: "10",
          },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const [os] = await conn.listServiceOrders();

    expect(os.sgpOsId).toBe("555");
    expect(os.statusCode).toBe(0);
    expect(os.clienteNome).toBe("Maria Silva");
    expect(os.endereco.lat).toBeCloseTo(-5.79448);
    expect(os.endereco.lng).toBeCloseTo(-35.211);
    expect(os.tecnicoSgpId).toBe("10");

    // Requisicao de listagem usa POST JSON (app+token no corpo), nao form-urlencoded.
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/ura/ordemservico/list/");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(options.body as string);
    expect(body.app).toBe(creds.app);
    expect(body.token).toBe(creds.token);
  });

  it("listServiceOrders converte contrato_id/motivo/tecnico numericos para string (regressao de producao)", async () => {
    // Um SGP real (CITmax) retorna esses campos como numero JSON, nao string,
    // o que quebrava prisma.ordemServico.upsert() ("Expected String or Null,
    // provided Int") e fazia o Map lookup de tipo/tecnico falhar em silencio.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ordens_servicos: [
          {
            os_id: "6740",
            os_status: 0,
            motivo: 1,
            contrato_id: 1268,
            os_tecnico_responsavel_id: 10,
            cliente_cpfcnpj: 12345678900,
          },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const [os] = await conn.listServiceOrders();

    expect(os.contratoId).toBe("1268");
    expect(typeof os.contratoId).toBe("string");
    expect(os.tipoCodigo).toBe("1");
    expect(typeof os.tipoCodigo).toBe("string");
    expect(os.tecnicoSgpId).toBe("10");
    expect(typeof os.tecnicoSgpId).toBe("string");
    expect(os.clienteDocumento).toBe("12345678900");
  });

  it("listOccurrences converte contrato numerico para string (regressao de producao)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ocorrencias: [{ numero: "260724151100", contrato: 97, status: "Encerrada" }] }),
    );

    const conn = createSgpConnector(creds);
    const [ocorrencia] = await conn.listOccurrences();

    expect(ocorrencia.contratoId).toBe("97");
    expect(typeof ocorrencia.contratoId).toBe("string");
  });

  it("listServiceOrders extrai motivo/pop/contrato_status/data+hora do payload real do SGP (CITmax)", async () => {
    // Payload real capturado em producao (via SGP_DEBUG_RAW) — o SGP so manda
    // o "motivo" como texto (sem motivo_id), separa data e hora em campos
    // distintos, e nao manda nenhum campo de endereco de rua.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ordens_servicos: [
          {
            cliente: "MAXSON SAVELLE ALEXANDRE SILVA",
            contrato: 1268,
            contrato_status: "Cancelado",
            contrato_status_id: 3,
            ocorrencia: "260724105700",
            id: 6740,
            status: "Aberta",
            status_id: 0,
            data_cadastro: "2026-07-24",
            hora_cadastro: "10:57:51",
            data_agendamento: "",
            hora_agendamento: "",
            data_finalizacao: "",
            hora_finalizacao: "",
            tipo: "Externa",
            tipo_id: 1,
            motivo: "🚨 Retirada 🚨",
            pop: "Macaíba",
            conteudo: "Cancelamento do Contrato 1268 do cliente 1141.",
            responsavel: "",
            tecnicos_auxiliares: [],
            usuario: "joelma",
            usuario_finalizacao: "",
            classificacoes: [],
          },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const [os] = await conn.listServiceOrders();

    expect(os.tipoCodigo).toBe("🚨 Retirada 🚨");
    expect(os.contratoStatus).toBe("Cancelado");
    expect(os.pop).toBe("Macaíba");
    expect(os.usuario).toBe("joelma");
    expect(os.dataCadastro).toBe("2026-07-24T10:57:51");
    expect(os.dataAgendamento).toBeNull();
  });

  it("listOccurrences extrai cliente/pop/metodo/data_finalizacao do payload real do SGP (CITmax)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ocorrencias: [
          {
            id: 41178,
            cliente: "IGREJA BATISTA LAGOINHA NATAL",
            contrato: 97,
            contrato_status: "Ativo",
            contrato_status_id: 1,
            pop: "Macaíba",
            numero: "260724151100",
            status: "Encerrada",
            status_id: 1,
            data_cadastro: "2026-07-24",
            data_agendamento: "",
            data_finalizacao: "2026-07-24",
            tipo: "💰 Financeiro - Outros",
            metodo: "Telefone",
            conteudo: "Envio de Fatura via URA",
            responsavel: "",
            usuario: "system",
            usuario_finalizacao: "",
            servico: [],
            comentarios: [],
            ordens_servicos: [],
          },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const [ocorrencia] = await conn.listOccurrences();

    expect(ocorrencia.clienteNome).toBe("IGREJA BATISTA LAGOINHA NATAL");
    expect(ocorrencia.contratoStatus).toBe("Ativo");
    expect(ocorrencia.pop).toBe("Macaíba");
    expect(ocorrencia.metodo).toBe("Telefone");
    expect(ocorrencia.usuario).toBe("system");
    expect(ocorrencia.dataCadastro).toBe("2026-07-24");
    expect(ocorrencia.dataFinalizacao).toBe("2026-07-24");
  });

  it("listServiceOrders retorna endereco sem lat/lng quando endereco_ll esta ausente", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0 }] }),
    );

    const conn = createSgpConnector(creds);
    const [os] = await conn.listServiceOrders();

    expect(os.endereco.lat).toBeNull();
    expect(os.endereco.lng).toBeNull();
  });

  it("setOnTheWay chama o endpoint /acaminho/ com app+token no corpo", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const conn = createSgpConnector(creds);
    await conn.setOnTheWay("555");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/acaminho/id/555/");
    const body = new URLSearchParams(options.body as string);
    expect(body.get("app")).toBe(creds.app);
    expect(body.get("token")).toBe(creds.token);
  });

  it("updateOsStatus envia o codigo de status numerico no corpo form-urlencoded", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const conn = createSgpConnector(creds);
    await conn.updateOsStatus("555", 1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/update/id/555/");
    const body = new URLSearchParams(options.body as string);
    expect(body.get("os_status")).toBe("1");
  });

  it("addOsNote envia o texto da anotacao", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const conn = createSgpConnector(creds);
    await conn.addOsNote("555", "Cliente reagendou");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/anotacoes/add/id/555/");
    const body = new URLSearchParams(options.body as string);
    expect(body.get("anotacao")).toBe("Cliente reagendou");
  });

  it("propaga erro com o corpo da resposta quando o SGP falha numa escrita", async () => {
    fetchMock.mockResolvedValueOnce(new Response("OS ja encerrada", { status: 422 }));

    const conn = createSgpConnector(creds);
    await expect(conn.updateOsStatus("555", 1)).rejects.toThrow(/422/);
  });

  describe("checkConnectionStatus", () => {
    it("reconhece 'Serviço Offline' e retorna online:false (payload real do SGP)", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          razaoSocial: "EMPRESA TESTE - VARIOS CONTRATOS",
          staus: 2,
          cpfCnpj: "68.857.751/0001-62",
          msg: "Serviço Offline",
          contratoId: 308,
        }),
      );

      const conn = createSgpConnector(creds);
      const resultado = await conn.checkConnectionStatus("308");

      expect(resultado.online).toBe(false);
      expect(resultado.mensagem).toBe("Serviço Offline");

      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/ura/verificaacesso/");
      const body = new URLSearchParams(options.body as string);
      expect(body.get("contrato")).toBe("308");
      expect(body.get("app")).toBe(creds.app);
      expect(body.get("token")).toBe(creds.token);
    });

    it("reconhece 'Serviço Online' e retorna online:true", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0, msg: "Serviço Online", contratoId: 308 }));

      const conn = createSgpConnector(creds);
      const resultado = await conn.checkConnectionStatus("308");

      expect(resultado.online).toBe(true);
    });

    it("retorna online:null quando a mensagem nao e reconhecida, sem lancar erro", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0, msg: "Contrato nao encontrado" }));

      const conn = createSgpConnector(creds);
      const resultado = await conn.checkConnectionStatus("999999");

      expect(resultado.online).toBeNull();
      expect(resultado.mensagem).toBe("Contrato nao encontrado");
    });

    it("retorna online:null (nao lanca) quando o SGP responde erro de rede/HTTP", async () => {
      fetchMock.mockResolvedValueOnce(new Response("erro interno", { status: 500 }));

      const conn = createSgpConnector(creds);
      const resultado = await conn.checkConnectionStatus("308");

      expect(resultado.online).toBeNull();
      expect(resultado.mensagem).toContain("500");
    });
  });
});
