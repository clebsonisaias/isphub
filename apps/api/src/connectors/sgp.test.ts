import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapSgpOsStatus, OsStatus } from "@isphub/shared";
import { createSgpConnector, redigirSegredosFttx, SgpError } from "./sgp.js";

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

  it("testConnection retorna ok:false quando o SGP responde erro — em UMA tentativa", async () => {
    // Antes o token so ia no header e o fallback com token na query gastava uma
    // 2a ida ao SGP em TODA leitura. Agora token+app vao na query desde a
    // primeira, como a doc de "Listar OLT" manda — uma requisicao basta.
    fetchMock.mockResolvedValueOnce(new Response("credenciais invalidas", { status: 401 }));

    const conn = createSgpConnector(creds);
    const resultado = await conn.testConnection();

    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET manda token E app na query (formato documentado)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await createSgpConnector(creds).listarOlts();

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/fttx/olt/list/");
    expect(url.searchParams.get("app")).toBe(creds.app);
    expect(url.searchParams.get("token")).toBe(creds.token);
  });

  it("listarOlts le o formato REAL da doc: array cru com name/olttype", async () => {
    // Resposta literal da doc de "Listar OLT". `olttype` era ignorado, entao o
    // fabricante vinha sempre null na tela de provisionamento.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ name: "ONU_TESTE", olttype: "Parks", onu_count: 0, host: "172.0.0.201", pon_count: 1, id: 30 }]),
    );

    const olts = await createSgpConnector(creds).listarOlts();

    expect(olts).toEqual([{ id: "30", nome: "ONU_TESTE", fabricante: "Parks" }]);
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
            os_tecnico_responsavel: "Joao Tecnico",
          },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const { itens: [os] } = await conn.listServiceOrders();

    expect(os.sgpOsId).toBe("555");
    expect(os.statusCode).toBe(0);
    expect(os.clienteNome).toBe("Maria Silva");
    expect(os.endereco.lat).toBeCloseTo(-5.79448);
    expect(os.endereco.lng).toBeCloseTo(-35.211);
    expect(os.tecnicoSgpNome).toBe("Joao Tecnico");

    // Requisicao de listagem usa POST JSON (app+token no corpo), nao form-urlencoded.
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/ura/ordemservico/list/");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(options.body as string);
    expect(body.app).toBe(creds.app);
    expect(body.token).toBe(creds.token);
  });

  it("listServiceOrders converte contrato_id/motivo numericos para string (regressao de producao)", async () => {
    // Um SGP real (CITmax) retorna esses campos como numero JSON, nao string,
    // o que quebrava prisma.ordemServico.upsert() ("Expected String or Null,
    // provided Int") e fazia o Map lookup de tipo falhar em silencio.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ordens_servicos: [
          {
            os_id: "6740",
            os_status: 0,
            motivo: 1,
            contrato_id: 1268,
            cliente_cpfcnpj: 12345678900,
          },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const { itens: [os] } = await conn.listServiceOrders();

    expect(os.contratoId).toBe("1268");
    expect(typeof os.contratoId).toBe("string");
    expect(os.tipoCodigo).toBe("1");
    expect(typeof os.tipoCodigo).toBe("string");
    expect(os.clienteDocumento).toBe("12345678900");
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
    const { itens: [os] } = await conn.listServiceOrders();

    expect(os.tipoCodigo).toBe("🚨 Retirada 🚨");
    expect(os.contratoStatus).toBe("Cancelado");
    expect(os.pop).toBe("Macaíba");
    expect(os.usuario).toBe("joelma");
    // -03:00 explicito: o SGP manda hora do Brasil sem indicacao de fuso, e
    // sem isso `new Date(...)` interpretava como hora LOCAL DO CONTAINER
    // (UTC, por nao ter TZ configurada) — toda OS ficava com "aberta ha"
    // inflado em +3h. Ver a nota em comFusoSgp.
    expect(os.dataCadastro).toBe("2026-07-24T10:57:51-03:00");
    expect(os.dataAgendamento).toBeNull();
  });

  /*
   * BUG DE FUSO — "aberta ha" inflado em +3h numa OS aberta ha 15 minutos.
   *
   * O SGP manda data/hora do Brasil SEM marcar o fuso. `new Date(string sem
   * offset)` interpreta como hora LOCAL DO PROCESSO — e o container roda sem
   * `TZ` configurada (node:22-alpine, default UTC). Toda dataCadastro ficava
   * gravada 3h adiantada: 10:57 BRT virava 10:57 UTC = 07:57 BRT.
   *
   * O teste prova o INSTANTE final (via `new Date(...).toISOString()`), nao
   * so a string — e o que importa de verdade e o instante que "aberta ha" e
   * o alerta de SLA usam pra calcular o decorrido.
   */
  describe("fuso das datas do SGP — America/Fortaleza (-03:00) explicito", () => {
    it("data+hora combinadas: 10:57:51 BRT vira o instante certo em UTC (13:57:51)", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0, data_cadastro: "2026-07-24", hora_cadastro: "10:57:51" }] }),
      );
      const { itens: [os] } = await createSgpConnector(creds).listServiceOrders();
      expect(new Date(os.dataCadastro!).toISOString()).toBe("2026-07-24T13:57:51.000Z");
    });

    it("so a data (sem hora): meia-noite EM BRASILIA, nao meia-noite UTC", async () => {
      // Antes: "2026-07-24" sozinho virava meia-noite UTC = 21h do dia
      // ANTERIOR em Brasilia — uma OS podia aparecer com a data errada.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0, data_cadastro: "2026-07-24" }] }),
      );
      const { itens: [os] } = await createSgpConnector(creds).listServiceOrders();
      expect(new Date(os.dataCadastro!).toISOString()).toBe("2026-07-24T03:00:00.000Z");
    });

    it("fallback os_data_agendamento (formato com ESPACO, nao 'T') tambem ganha o fuso", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0, os_data_agendamento: "2026-12-31 09:00:00" }] }),
      );
      const { itens: [os] } = await createSgpConnector(creds).listServiceOrders();
      expect(new Date(os.dataAgendamento!).toISOString()).toBe("2026-12-31T12:00:00.000Z");
    });

    it("os_data_agendamento ja com fuso explicito (Z) NAO e reinterpretado — protege contra double-offset", async () => {
      // Nenhuma instancia do SGP manda isto hoje (todas mandam naive), mas se
      // alguma um dia passar a mandar ISO completo, nao pode virar
      // "...12:00:00.000Z-03:00" (invalido) nem ter o instante deslocado de novo.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0, os_data_agendamento: "2026-12-31T12:00:00.000Z" }] }),
      );
      const { itens: [os] } = await createSgpConnector(creds).listServiceOrders();
      expect(os.dataAgendamento).toBe("2026-12-31T12:00:00.000Z");
    });
  });

  it("listServiceOrders le o status de status_id, nao do rotulo textual (regressao: tudo virava 'aberta')", async () => {
    // Payload real da CITmax: o rotulo vem em "status" e o codigo em
    // "status_id". Ler o texto fazia Number() virar NaN -> default "Aberta",
    // entao OS encerradas apareciam abertas no ISPhub indefinidamente.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ordens_servicos: [
          { id: 6746, status: "Encerrada", status_id: 1, motivo: "🛠️ Reparo", contrato: 1607 },
          { id: 6747, status: "Aberta", status_id: 0, motivo: "🚨 Retirada 🚨", contrato: 724 },
        ],
      }),
    );

    const conn = createSgpConnector(creds);
    const { itens: [encerrada, aberta] } = await conn.listServiceOrders();

    expect(mapSgpOsStatus(encerrada.statusCode)).toBe(OsStatus.CONCLUIDA);
    expect(mapSgpOsStatus(aberta.statusCode)).toBe(OsStatus.ABERTA);
  });

  it("listServiceOrders ainda funciona quando o SGP so manda o rotulo textual (sem status_id)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ordens_servicos: [{ id: 99, status: "Encerrada", motivo: "Reparo" }] }),
    );

    const conn = createSgpConnector(creds);
    const { itens: [os] } = await conn.listServiceOrders();

    expect(mapSgpOsStatus(os.statusCode)).toBe(OsStatus.CONCLUIDA);
  });

  it("listServiceOrders retorna endereco sem lat/lng quando endereco_ll esta ausente", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0 }] }),
    );

    const conn = createSgpConnector(creds);
    const { itens: [os] } = await conn.listServiceOrders();

    expect(os.endereco.lat).toBeNull();
    expect(os.endereco.lng).toBeNull();
  });

  it("setOnTheWay envia JSON — como form o SGP recusava com 403 de corpo vazio", async () => {
    // Regressao real (OS #5326): o 403 sem corpo parecia falta de permissao do
    // token e mandou a investigacao pro lado errado. Era o Content-Type.
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const conn = createSgpConnector(creds);
    await conn.setOnTheWay("555");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/acaminho/id/555/");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(options.body as string);
    expect(body.app).toBe(creds.app);
    expect(body.token).toBe(creds.token);
  });

  it("setOnTheWay: SGP antigo que so aceita form recebe a 2a tentativa em form", async () => {
    // 4xx = recusa, nada foi escrito -> repetir de outro jeito e seguro.
    fetchMock.mockResolvedValueOnce(new Response("", { status: 415 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const conn = createSgpConnector(creds);
    await conn.setOnTheWay("555");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, primeira] = fetchMock.mock.calls[0];
    const [, segunda] = fetchMock.mock.calls[1];
    expect((primeira.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((segunda.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(segunda.body as string).get("token")).toBe(creds.token);
  });

  it("setOnTheWay: 5xx NAO repete — a escrita pode ter acontecido e repetir duplicaria", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));

    const conn = createSgpConnector(creds);
    await expect(conn.setOnTheWay("555")).rejects.toThrow(/SGP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("credencial no header em TODA escrita", () => {
    // Regressao real (OS #5326): as escritas iam so com app+token no CORPO,
    // sem header nenhum, enquanto as leituras sempre mandaram no header. Um
    // SGP que autentica por header via a escrita chegar sem credencial e
    // respondia 403 de corpo VAZIO — que parecia falta de permissao do token.
    const escritas: [string, (c: ReturnType<typeof createSgpConnector>) => Promise<unknown>][] = [
      ["setOnTheWay (JSON)", (c) => c.setOnTheWay("555")],
      ["updateOsStatus (JSON)", (c) => c.updateOsStatus("555", 1)],
      ["addOsNote (form)", (c) => c.addOsNote("555", "nota")],
      ["provisionarOnu (form)", (c) => c.provisionarOnu("olt-1", { slot: "1", pon: "2", serial: "SN1", mode: 2 })],
    ];

    for (const [nome, chamar] of escritas) {
      it(`${nome} manda Authorization e X-SGP-Token`, async () => {
        fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        await chamar(createSgpConnector(creds));

        const [, options] = fetchMock.mock.calls[0];
        const headers = options.headers as Record<string, string>;
        expect(headers.Authorization).toBe(`Token ${creds.token}`);
        expect(headers["X-SGP-Token"]).toBe(creds.token);
      });
    }

    it("multipart (verificaacesso) manda credencial no header e NAO fixa Content-Type (boundary do FormData)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ msg: "Serviço Online" }));

      await createSgpConnector(creds).checkConnectionStatus("1672");

      const [, options] = fetchMock.mock.calls[0];
      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Token ${creds.token}`);
      expect(headers["Content-Type"]).toBeUndefined();
    });
  });

  it("updateOsStatus envia JSON (nao form-urlencoded) — a doc de 'Alterar OS' exige application/json", async () => {
    // Regressao real: enviado como form-urlencoded, o SGP responde 200 e
    // ignora o corpo inteiro — o status simplesmente nao mudava, sem erro.
    fetchMock.mockResolvedValueOnce(jsonResponse({ msg: "OS alterada com sucesso", os_id: 555 }));

    const conn = createSgpConnector(creds);
    await conn.updateOsStatus("555", 1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/update/id/555/");
    expect(options.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(options.body as string);
    expect(body.os_status).toBe(1);
    expect(typeof body.os_status).toBe("number");
    expect(body.app).toBe(creds.app);
    expect(body.token).toBe(creds.token);
  });

  it("updateOsStatus manda SO os_status (+ credencial) — nada de data/checkin/assinatura", async () => {
    // A doc de "Alterar Ordem de Servico" lista todo o resto como opcional, e
    // mudar status no ISPhub nao pede nada a quem clica. Antes iam duas datas
    // que ninguem pediu: o SGP estampa as dele.
    fetchMock.mockResolvedValueOnce(jsonResponse({ msg: "OS alterada com sucesso", os_id: 555 }));

    await createSgpConnector(creds).updateOsStatus("555", 1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ app: creds.app, token: creds.token, os_status: 1 });
    expect(body.os_data_finalizacao).toBeUndefined();
    expect(body.os_data_alteracao).toBeUndefined();
    expect(body.checkin_data).toBeUndefined();
    expect(body.assinatura_cliente).toBeUndefined();
  });

  it("updateOsStatus aceita os 4 status documentados", async () => {
    // 0=Aberta, 1=Encerrada, 2=Em execucao, 3=Pendente.
    for (const codigo of [0, 1, 2, 3]) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ msg: "ok" }));
      await createSgpConnector(creds).updateOsStatus("555", codigo);
      const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
      expect(body.os_status).toBe(codigo);
      expect(typeof body.os_status).toBe("number");
    }
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
    fetchMock.mockResolvedValueOnce(new Response("Falha de validacao no cadastro", { status: 422 }));

    const conn = createSgpConnector(creds);
    await expect(conn.updateOsStatus("555", 1)).rejects.toThrow(/422/);
  });

  it("updateOsStatus trata 'OS ja foi encerrada' como sucesso idempotente quando o alvo era Encerrada (payload real do SGP)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "OS já foi encerrada", os_id: 6186 }), { status: 422 }),
    );

    const conn = createSgpConnector(creds);
    await expect(conn.updateOsStatus("6186", 1)).resolves.toBeUndefined();
  });

  it("updateOsStatus NAO trata 'ja foi encerrada' como sucesso quando o alvo nao era Encerrada", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "OS já foi encerrada" }), { status: 422 }),
    );

    const conn = createSgpConnector(creds);
    // statusCode 2 = Em execucao, nao Encerrada — a recusa deve propagar normalmente.
    await expect(conn.updateOsStatus("6186", 2)).rejects.toThrow(/encerrada/);
  });

  it("updateOsStatus rejeita quando o SGP recusa por regra de negocio mas responde HTTP 200 com 'erro' no corpo", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ erro: "Não é possível encerrar OS de contrato cancelado" }));

    const conn = createSgpConnector(creds);
    await expect(conn.updateOsStatus("555", 1)).rejects.toThrow(/contrato cancelado/);
  });

  it("updateOsStatus rejeita quando o SGP responde HTTP 200 com sucesso:false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ sucesso: false, msg: "Operação não permitida" }));

    const conn = createSgpConnector(creds);
    await expect(conn.updateOsStatus("555", 1)).rejects.toThrow(/Operação não permitida/);
  });

  it("setOnTheWay rejeita quando o SGP responde HTTP 200 com erro no corpo", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "OS não pertence a este contrato" }));

    const conn = createSgpConnector(creds);
    await expect(conn.setOnTheWay("555")).rejects.toThrow(/não pertence/);
  });

  it("addOsNote rejeita quando o SGP responde HTTP 200 com erro no corpo", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }));

    const conn = createSgpConnector(creds);
    await expect(conn.addOsNote("555", "texto")).rejects.toThrow(/recusado pelo SGP/);
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
      // Documentado com `curl --form` (multipart), diferente do form-urlencoded
      // usado no resto do conector.
      const body = options.body as FormData;
      expect(body).toBeInstanceOf(FormData);
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

  describe("getDetalhesTecnicos", () => {
    // O payload real de /api/ura/clientes/ nao tem nenhum campo de status de
    // conexao dentro de "onu" (confirmado ao vivo em producao) — por isso
    // getDetalhesTecnicos chama /api/ura/verificaacesso/ em paralelo (a
    // mesma consulta de checkConnectionStatus) pra obter online/offline.
    // Os testes abaixo mockam as duas chamadas, na ordem em que o codigo as
    // dispara dentro do Promise.all: /clientes/ primeiro, /verificaacesso/ depois.

    it("extrai endereco e sinal ONU do payload real (doc oficial /api/ura/clientes/) e online do verificaacesso", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            paginacao: { offset: 0, limit: 100, parcial: 1, total: 1 },
            clientes: [
              {
                nome: "MARIA SILVA",
                cpfcnpj: "00000000000",
                contratos: [
                  {
                    contrato: 75,
                    status: "Ativo",
                    servicos: [
                      {
                        id: 1,
                        tipo: "internet",
                        login: "LOGIN",
                        onu: { rx: "-19.500", tx: "2.500", olt_nome: "OLT-MACAIBA-01" },
                        endereco: {
                          logradouro: "Rua das Flores",
                          numero: 123,
                          bairro: "Centro",
                          cidade: "Macaíba",
                          uf: "RN",
                          cep: "59280-000",
                          latitude: "-5.8555",
                          longitude: "-35.3555",
                        },
                      },
                    ],
                  },
                ],
                endereco: { logradouro: "Endereco do cliente (fallback)", bairro: "Outro bairro" },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ status: 0, msg: "Serviço Online", contratoId: 75 }));

      const conn = createSgpConnector(creds);
      const resultado = await conn.getDetalhesTecnicos("75");

      expect(resultado.online).toBe(true);
      expect(resultado.mensagem).toBe("Serviço Online");
      expect(resultado.sinalRxDbm).toBeCloseTo(-19.5);
      expect(resultado.sinalTxDbm).toBeCloseTo(2.5);
      expect(resultado.oltNome).toBe("OLT-MACAIBA-01");
      // Prefere o endereco do servico (mais especifico) ao do cliente.
      expect(resultado.endereco?.logradouro).toBe("Rua das Flores");
      expect(resultado.endereco?.bairro).toBe("Centro");
      expect(resultado.endereco?.lat).toBeCloseTo(-5.8555);
      expect(resultado.endereco?.lng).toBeCloseTo(-35.3555);

      const [urlClientes, optionsClientes] = fetchMock.mock.calls[0];
      expect(String(urlClientes)).toContain("/api/ura/clientes/");
      const bodyClientes = new URLSearchParams(optionsClientes.body as string);
      expect(bodyClientes.get("contrato")).toBe("75");

      const [urlAcesso] = fetchMock.mock.calls[1];
      expect(String(urlAcesso)).toContain("/api/ura/verificaacesso/");
    });

    it("cai pro endereco do cliente quando o servico nao tem endereco proprio", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            clientes: [
              {
                nome: "CLIENTE X",
                contratos: [{ contrato: 1, servicos: [{ id: 1 }] }],
                endereco: { logradouro: "Av. Central", bairro: "Vila Nova" },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ status: 0, msg: "Contrato nao encontrado" }));

      const conn = createSgpConnector(creds);
      const resultado = await conn.getDetalhesTecnicos("1");

      expect(resultado.endereco?.logradouro).toBe("Av. Central");
      expect(resultado.endereco?.bairro).toBe("Vila Nova");
      expect(resultado.online).toBeNull();
      expect(resultado.sinalRxDbm).toBeNull();
    });

    it("retorna vazio (sem lancar) quando o contrato nao existe, mas ainda tenta online do verificaacesso", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ clientes: [] }))
        .mockResolvedValueOnce(jsonResponse({ status: 0, msg: "Serviço Offline" }));

      const conn = createSgpConnector(creds);
      const resultado = await conn.getDetalhesTecnicos("999999");

      expect(resultado.endereco).toBeNull();
      expect(resultado.online).toBe(false);
    });
  });

  describe("getContratoCadastro (backfill do mapa/card)", () => {
    // Versao enxuta de getDetalhesTecnicos: endereco de rua + geo + telefone do
    // cadastro do cliente, sem verificaacesso — uma unica chamada a
    // /api/ura/clientes/ por contrato.

    it("extrai endereco, lat/lng e telefone do servico e faz UMA so chamada (sem verificaacesso)", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          clientes: [
            {
              nome: "MARIA SILVA",
              telefone: "(84) 99999-8888",
              contratos: [
                {
                  contrato: 75,
                  servicos: [
                    {
                      id: 1,
                      endereco: {
                        logradouro: "Rua das Flores",
                        numero: 123,
                        bairro: "Centro",
                        cidade: "Macaíba",
                        latitude: "-5.8555",
                        longitude: "-35.3555",
                      },
                    },
                  ],
                },
              ],
              endereco: { latitude: "-9.9", longitude: "-9.9" },
            },
          ],
        }),
      );

      const conn = createSgpConnector(creds);
      const cadastro = await conn.getContratoCadastro("75");

      expect(cadastro?.lat).toBeCloseTo(-5.8555);
      expect(cadastro?.lng).toBeCloseTo(-35.3555);
      expect(cadastro?.logradouro).toBe("Rua das Flores");
      expect(cadastro?.numero).toBe("123");
      expect(cadastro?.bairro).toBe("Centro");
      expect(cadastro?.cidade).toBe("Macaíba");
      expect(cadastro?.telefone).toBe("(84) 99999-8888");
      // So a chamada a /clientes/ — nada de verificaacesso no backfill em massa.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/ura/clientes/");
      expect(new URLSearchParams(options.body as string).get("contrato")).toBe("75");
    });

    it("extrai o telefone da lista telefones_cargos quando nao ha campo direto (forma da doc 'Cliente - Consultar')", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          clientes: [
            {
              nome: "JOAO",
              telefones_cargos: [{ cargo: null, contato: "(99) 9999-9999", nome: null }],
              contratos: [{ contrato: 5, servicos: [{ id: 1, endereco: { latitude: "-5.7", longitude: "-35.2" } }] }],
            },
          ],
        }),
      );

      const conn = createSgpConnector(creds);
      const cadastro = await conn.getContratoCadastro("5");

      expect(cadastro?.telefone).toBe("(99) 9999-9999");
    });

    /*
     * `contatos` como OBJETO, nao array — forma real do SGP da CITmax,
     * confirmada em producao (31/07) pelo log de campos do cadastro.
     *
     * A versao anterior fazia `if (!Array.isArray(lista)) continue` e pulava o
     * container inteiro: o telefone estava no payload o tempo todo e o card
     * mostrava CONTATO vazio em TODA OS ("0 com telefone" no backfill de 30
     * contratos, sendo que 23 traziam coordenada do MESMO payload).
     */
    describe("contatos em forma de OBJETO (regressao de producao)", () => {
      const comContatos = (contatos: unknown) =>
        jsonResponse({ clientes: [{ nome: "CLIENTE", contatos, contratos: [{ contrato: 1, servicos: [{ id: 1 }] }] }] });

      it("objeto com chave de telefone direto", async () => {
        fetchMock.mockResolvedValueOnce(comContatos({ celular: "(84) 98888-7777", email: "x@y.com" }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("(84) 98888-7777");
      });

      it("objeto indexado ({'0': {...}}) — colecao que nao virou array no JSON", async () => {
        fetchMock.mockResolvedValueOnce(comContatos({ "0": { contato: "(84) 97777-6666", cargo: null } }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("(84) 97777-6666");
      });

      it("NAO confunde e-mail com telefone quando o valor esta solto no objeto", async () => {
        // `email` nao esta nos aliases e nao parece telefone — tem que ser
        // ignorado, senao o card mostraria um e-mail no lugar do contato.
        fetchMock
          .mockResolvedValueOnce(comContatos({ email: "cliente@exemplo.com", observacao: "ligar a tarde" }))
          .mockResolvedValueOnce(jsonResponse({ clientes: [] }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBeNull();
      });

      it("valor solto que PARECE telefone (DDD + 10-11 digitos) e aceito", async () => {
        fetchMock.mockResolvedValueOnce(comContatos({ principal: "84 99999-1234" }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("84 99999-1234");
      });

      it("array continua funcionando (nao regride a forma ja suportada)", async () => {
        fetchMock.mockResolvedValueOnce(comContatos([{ contato: "(84) 96666-5555" }]));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("(84) 96666-5555");
      });

      // O SGP nao promete tipo aqui: um telefone sem mascara pode chegar como
      // number, e ai `typeof item === "string"` deixava passar batido.
      it("valor NUMERICO solto e reconhecido como telefone", async () => {
        fetchMock.mockResolvedValueOnce(comContatos({ principal: 84999991234 }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("84999991234");
      });

      /*
       * A FORMA REAL, medida em producao (31/07) no SGP da CITmax:
       *   contatos = { celulares: [], emails: [], outros: [], telefones: [] }
       * Objeto cujos valores sao ARRAYS — o telefone fica DOIS niveis abaixo de
       * `contatos`. Confirmada duas vezes de forma independente: pelo log de
       * chaves do container e pelo Maxxi, que consome o mesmo endpoint em
       * producao (maxxi/src/services/clientes.js:50).
       */
      it("forma real da CITmax: {celulares,emails,outros,telefones} com arrays", async () => {
        fetchMock.mockResolvedValueOnce(
          comContatos({ celulares: [], emails: ["x@y.com"], outros: [], telefones: ["(84) 3222-1010"] }),
        );
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("(84) 3222-1010");
      });

      it("pega o celular quando so ele esta preenchido", async () => {
        fetchMock.mockResolvedValueOnce(
          comContatos({ celulares: ["84 98888-7777"], emails: [], outros: [], telefones: [] }),
        );
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("84 98888-7777");
      });

      it("so e-mail preenchido nao vira telefone", async () => {
        fetchMock
          .mockResolvedValueOnce(comContatos({ celulares: [], emails: ["cliente@exemplo.com"], outros: [], telefones: [] }))
          .mockResolvedValueOnce(jsonResponse({ contratos: [] }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBeNull();
      });

      it("lista de objetos dentro do array (outra instancia do SGP)", async () => {
        fetchMock.mockResolvedValueOnce(comContatos({ telefones: [{ numero: "(84) 3111-2020", tipo: "fixo" }] }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("(84) 3111-2020");
      });

      it("numero que NAO parece telefone (id, cep) nao vira contato", async () => {
        fetchMock
          .mockResolvedValueOnce(comContatos({ id: 4271, cep: 59000000 }))
          .mockResolvedValueOnce(jsonResponse({ clientes: [] }));
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBeNull();
      });
    });

    it("cai pro endereco do cliente quando o servico nao tem endereco proprio", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            clientes: [
              {
                contratos: [{ contrato: 1, servicos: [{ id: 1 }] }],
                endereco: { logradouro: "Av. Central", latitude: "-5.7", longitude: "-35.2" },
              },
            ],
          }),
        )
        // Sem telefone na 1a resposta, entao o fallback de contrato inativo
        // roda — e tambem nao acha nada. O endereco da 1a resposta e mantido.
        .mockResolvedValueOnce(jsonResponse({ clientes: [] }));

      const conn = createSgpConnector(creds);
      const cadastro = await conn.getContratoCadastro("1");

      expect(cadastro?.logradouro).toBe("Av. Central");
      expect(cadastro?.lat).toBeCloseTo(-5.7);
      expect(cadastro?.lng).toBeCloseTo(-35.2);
    });

    it("retorna campos null quando o cliente existe mas nao tem coordenada/telefone (0/vazio -> null)", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ clientes: [{ contratos: [{ contrato: 1, servicos: [{ id: 1, endereco: { latitude: "0", longitude: "" } }] }] }] }),
        )
        .mockResolvedValueOnce(jsonResponse({ clientes: [] }));

      const conn = createSgpConnector(creds);
      const cadastro = await conn.getContratoCadastro("1");

      // Consultado (nao-null), mas sem dado — o sync marca geoConsultadoEm e nao insiste.
      expect(cadastro).not.toBeNull();
      expect(cadastro?.lat).toBeNull();
      expect(cadastro?.lng).toBeNull();
      expect(cadastro?.telefone).toBeNull();
    });

    it("retorna null quando o contrato nao existe em NENHUM dos dois endpoints", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ clientes: [] }))
        .mockResolvedValueOnce(jsonResponse({ clientes: [] }));

      const conn = createSgpConnector(creds);
      expect(await conn.getContratoCadastro("999999")).toBeNull();
    });

    /*
     * CONTRATO INATIVO — o card mostrava CONTATO vazio (visto na OS #6720).
     * `/api/ura/clientes/` nao aceita filtro de status e nao devolve contrato
     * fora de "ativo"; `/api/ura/consultacliente/` aceita, e e o unico caminho
     * que alcanca o cadastro nesse caso.
     */
    describe("fallback pra contrato inativo/cancelado (consultacliente)", () => {
      /*
       * O envelope do consultacliente e `{ contratos: [...], msg }` — NAO tem
       * chave "clientes", e os campos vem PLANOS no contrato, em camelCase.
       * Medido em producao ("chaves: [contratos, msg]") e confirmado no Maxxi,
       * que consome esse endpoint (maxxi/src/services/erp.js:_normalizarCliente).
       * Estes testes ja existiam com o envelope errado — passavam contra a
       * minha suposicao, nao contra o SGP.
       */
      it("clientes/ vazio + consultacliente traz o cadastro => usa o do fallback", async () => {
        fetchMock
          .mockResolvedValueOnce(jsonResponse({ clientes: [] }))
          .mockResolvedValueOnce(
            jsonResponse({
              msg: "ok",
              contratos: [
                {
                  contratoId: 1864,
                  razaoSocial: "MARIA DE FATIMA",
                  cpfCnpj: "123.456.789-00",
                  telefones: ["(84) 98888-7777"],
                  emails: [],
                  endereco_logradouro: "Rua X",
                  endereco_numero: "123",
                  endereco_bairro: "Centro",
                  endereco_cidade: "Natal",
                },
              ],
            }),
          );

        const conn = createSgpConnector(creds);
        const cadastro = await conn.getContratoCadastro("1864");

        expect(cadastro?.telefone).toBe("(84) 98888-7777");
        expect(cadastro?.logradouro).toBe("Rua X");
        expect(cadastro?.bairro).toBe("Centro");
        expect(cadastro?.cidade).toBe("Natal");

        // O fallback pede TODOS os status — senao nao alcanca inativo/cancelado.
        const [url, options] = fetchMock.mock.calls[1];
        expect(String(url)).toContain("/api/ura/consultacliente/");
        const corpo = new URLSearchParams(options.body as string);
        expect(corpo.get("contrato")).toBe("1864");
        expect(corpo.get("status")).toBe("1,2,3,4,5,6,7");
      });

      it("cliente veio SEM telefone no clientes/, mas o fallback tem => aproveita o telefone", async () => {
        fetchMock
          .mockResolvedValueOnce(
            jsonResponse({ clientes: [{ nome: "SEM FONE", contratos: [{ contrato: 9, servicos: [{ id: 1 }] }] }] }),
          )
          .mockResolvedValueOnce(
            jsonResponse({ contratos: [{ contratoId: 9, razaoSocial: "SEM FONE", telefones: ["(84) 91111-2222"] }] }),
          );

        const conn = createSgpConnector(creds);
        expect((await conn.getContratoCadastro("9"))?.telefone).toBe("(84) 91111-2222");
      });

      /*
       * O consultacliente nao traz lat/lng. Se o fallback SUBSTITUISSE o cliente
       * em vez de complementar, pegar o telefone la custaria a coordenada que a
       * consulta primaria ja tinha — trocaria o card sem contato por um pino a
       * menos no mapa.
       */
      it("pega o telefone do fallback SEM perder a coordenada do primario", async () => {
        fetchMock
          .mockResolvedValueOnce(
            jsonResponse({
              clientes: [
                {
                  nome: "COM GEO SEM FONE",
                  contratos: [
                    { contrato: 7, servicos: [{ id: 1, endereco: { logradouro: "Rua Z", latitude: "-5.79", longitude: "-35.21" } }] },
                  ],
                },
              ],
            }),
          )
          .mockResolvedValueOnce(
            jsonResponse({ contratos: [{ contratoId: 7, telefones: ["(84) 95555-4444"] }] }),
          );

        const cadastro = await createSgpConnector(creds).getContratoCadastro("7");

        expect(cadastro?.telefone).toBe("(84) 95555-4444");
        expect(cadastro?.lat).toBeCloseTo(-5.79);
        expect(cadastro?.lng).toBeCloseTo(-35.21);
        expect(cadastro?.logradouro).toBe("Rua Z");
      });

      it("escolhe entre varios contratos o que TEM telefone", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ clientes: [] })).mockResolvedValueOnce(
          jsonResponse({
            contratos: [
              { contratoId: 1, razaoSocial: "CLIENTE", telefones: [] },
              { contratoId: 2, razaoSocial: "CLIENTE", telefones: ["(84) 3333-4444"] },
            ],
          }),
        );
        expect((await createSgpConnector(creds).getContratoCadastro("1"))?.telefone).toBe("(84) 3333-4444");
      });

      it("contrato ATIVO com telefone NAO dispara o fallback — uma chamada so", async () => {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ clientes: [{ telefone: "(84) 99999-8888", contratos: [{ contrato: 75, servicos: [{ id: 1 }] }] }] }),
        );

        const conn = createSgpConnector(creds);
        await conn.getContratoCadastro("75");

        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("consultacliente inexistente/quebrado (404) NAO derruba o backfill — mantem o que ja tinha", async () => {
        // Instancia de SGP que nao expoe esse endpoint: o resultado tem que ser
        // o mesmo de antes desta mudanca, nunca pior.
        fetchMock
          .mockResolvedValueOnce(
            jsonResponse({ clientes: [{ contratos: [{ contrato: 5, servicos: [{ id: 1, endereco: { logradouro: "Rua Y", latitude: "-5.5", longitude: "-35.5" } }] }] }] }),
          )
          .mockResolvedValueOnce(new Response("not found", { status: 404 }));

        const conn = createSgpConnector(creds);
        const cadastro = await conn.getContratoCadastro("5");

        expect(cadastro).not.toBeNull();
        expect(cadastro?.logradouro).toBe("Rua Y");
        expect(cadastro?.telefone).toBeNull();
      });
    });

    it("retorna null (sem lancar) quando o SGP falha", async () => {
      // sgpPostForm nao faz retry (uma chamada so) — 500 lanca, getContratoCadastro captura.
      fetchMock.mockResolvedValueOnce(new Response("erro", { status: 500 }));

      const conn = createSgpConnector(creds);
      expect(await conn.getContratoCadastro("75")).toBeNull();
    });
  });

  describe("fotos de evidencia (hospedadas no SGP)", () => {
    // Payloads confirmados ao vivo contra o SGP real (CITmax) — upload de uma
    // imagem de teste na OS 5537 devolveu exatamente o shape abaixo.
    const imagemRealSgp = {
      id: "640",
      descricao: "Teste automatizado ISPhub",
      usuario: "system",
      arquivo: "ocorrencia/31550/Anexo_OS_5537_-_1.png",
    };

    it("addOsImage envia image_b64 + descricao como multipart PUT (campo confirmado no SGP real)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 1 }));

      const conn = createSgpConnector(creds);
      await conn.addOsImage("5537", "QUJD", "Foto do poste");

      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/os/imagem/id/5537/add/");
      expect(options.method).toBe("PUT");
      const body = options.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      // "image_b64" (exemplo de curl da doc), nao "image_base64" (prosa da doc)
      // — confirmado ao vivo: o SGP aceitou e criou o anexo.
      expect(body.get("image_b64")).toBe("QUJD");
      expect(body.get("descricao")).toBe("Foto do poste");
      expect(body.get("app")).toBe(creds.app);
      expect(body.get("token")).toBe(creds.token);
    });

    it("addOsImage rejeita quando o SGP recusa com erro no corpo (HTTP 200)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ erro: "Imagem invalida" }));

      const conn = createSgpConnector(creds);
      await expect(conn.addOsImage("5537", "QUJD")).rejects.toThrow(/Imagem invalida/);
    });

    it("listOsImages normaliza o payload real do SGP (id/descricao/usuario/arquivo)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ imagens: [imagemRealSgp] }));

      const conn = createSgpConnector(creds);
      const imagens = await conn.listOsImages("5537");

      expect(imagens).toHaveLength(1);
      expect(imagens[0].id).toBe("640");
      expect(imagens[0].descricao).toBe("Teste automatizado ISPhub");
      expect(imagens[0].usuario).toBe("system");
      expect(imagens[0].arquivo).toBe("ocorrencia/31550/Anexo_OS_5537_-_1.png");

      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/os/imagem/id/5537/list/");
    });

    it("listOsImages converte id numerico pra string (o SGP nao e consistente no tipo)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ imagens: [{ ...imagemRealSgp, id: 640 }] }));

      const conn = createSgpConnector(creds);
      const imagens = await conn.listOsImages("5537");

      expect(imagens[0].id).toBe("640");
    });

    it("listOsImages devolve lista vazia quando a OS nao tem foto (confirmado no SGP real)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ imagens: [] }));

      const conn = createSgpConnector(creds);
      expect(await conn.listOsImages("5537")).toEqual([]);
    });

    it("getOsImageFile corrige o Content-Type pelos magic bytes (o SGP diz png mas manda JPEG)", async () => {
      // Cenario real: o SGP salva todo anexo como .png e responde image/png,
      // mas o conteudo e o JPEG que foi enviado (assinatura FF D8 FF).
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      fetchMock.mockResolvedValueOnce(
        new Response(jpegBytes, { status: 200, headers: { "content-type": "image/png" } }),
      );

      const conn = createSgpConnector(creds);
      const arquivo = await conn.getOsImageFile("640");

      expect(arquivo).not.toBeNull();
      expect(arquivo!.contentType).toBe("image/jpeg");
      expect(arquivo!.bytes.slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    });

    it("getOsImageFile mantem image/png quando os bytes sao PNG de verdade", async () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      fetchMock.mockResolvedValueOnce(
        new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } }),
      );

      const conn = createSgpConnector(creds);
      const arquivo = await conn.getOsImageFile("640");

      expect(arquivo!.contentType).toBe("image/png");
    });

    it("getOsImageFile trata resposta JSON como 'nao encontrado' (erro disfarcado de 200)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ erro: "Anexo inexistente" }));

      const conn = createSgpConnector(creds);
      expect(await conn.getOsImageFile("999999")).toBeNull();
    });

    it("getOsImageFile devolve null quando o SGP responde erro HTTP", async () => {
      fetchMock.mockResolvedValueOnce(new Response("nao encontrado", { status: 404 }));

      const conn = createSgpConnector(creds);
      expect(await conn.getOsImageFile("999999")).toBeNull();
    });
  });

  describe("FTTX / provisionamento de ONU", () => {
    it("listarOlts normaliza id/nome/fabricante e bate em /api/fttx/olt/list/", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ olts: [{ id: 3, nome: "OLT-CENTRO", fabricante: "Huawei" }, { id: 4, name: "OLT-SUL" }] }),
      );

      const conn = createSgpConnector(creds);
      const olts = await conn.listarOlts();

      expect(olts).toEqual([
        { id: "3", nome: "OLT-CENTRO", fabricante: "Huawei" },
        { id: "4", nome: "OLT-SUL", fabricante: null },
      ]);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/fttx/olt/list/");
    });

    it("listarOlts segue paginacao estilo DRF (next) — nao paravam antes na 1a pagina", async () => {
      // Reproduz o bug real: NetGo so mostrava 1 OLT porque o SGP paginou a
      // resposta e o codigo antigo nunca seguia o `next`.
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            count: 2,
            next: "https://sgp.exemplo.com.br/api/fttx/olt/list/?page=2",
            previous: null,
            results: [{ id: 1, nome: "OLT-PAGINA-1" }],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ count: 2, next: null, previous: "...", results: [{ id: 2, nome: "OLT-PAGINA-2" }] }),
        );

      const conn = createSgpConnector(creds);
      const olts = await conn.listarOlts();

      expect(olts).toEqual([
        { id: "1", nome: "OLT-PAGINA-1", fabricante: null },
        { id: "2", nome: "OLT-PAGINA-2", fabricante: null },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // A URL do `next` ganha token+app quando o SGP nao os devolve nela. Sem
      // isso a pagina 2 volta 403 e a lista fica truncada em silencio — o
      // sintoma de "so aparece 1 OLT".
      const url2 = new URL(String(fetchMock.mock.calls[1][0]));
      expect(url2.pathname).toBe("/api/fttx/olt/list/");
      expect(url2.searchParams.get("page")).toBe("2");
      expect(url2.searchParams.get("token")).toBe(creds.token);
      expect(url2.searchParams.get("app")).toBe(creds.app);
      expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe(`Token ${creds.token}`);
    });

    it("next que JA traz token nao ganha um duplicado", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            count: 2,
            next: `https://sgp.exemplo.com.br/api/fttx/olt/list/?page=2&token=${creds.token}&app=${creds.app}`,
            results: [{ id: 1, nome: "P1" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ count: 2, next: null, results: [{ id: 2, nome: "P2" }] }));

      await createSgpConnector(creds).listarOlts();

      const url2 = new URL(String(fetchMock.mock.calls[1][0]));
      expect(url2.searchParams.getAll("token")).toEqual([creds.token]);
      expect(url2.searchParams.getAll("app")).toEqual([creds.app]);
    });

    it("listarOnusNaoAutorizadas mapeia phy_addr->serial e info_rx->sinalRxDbm", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          onus: [{ id: 10, phy_addr: "HWTC12345678", slot: 1, pon: 2, type: "HG8310", vlan: 100, info_rx: "-21.5" }],
        }),
      );

      const conn = createSgpConnector(creds);
      const [onu] = await conn.listarOnusNaoAutorizadas("3");

      expect(onu).toEqual({
        id: "10",
        serial: "HWTC12345678",
        slot: "1",
        pon: "2",
        tipo: "HG8310",
        vlan: 100,
        sinalRxDbm: -21.5,
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/fttx/olt/3/unauth/");
    });

    it("listarOnusNaoAutorizadas cai pro POST /onu/unauthorized/ quando o GET /unauth/ falha", async () => {
      fetchMock
        .mockResolvedValueOnce(new Response("nao encontrado", { status: 404 }))
        .mockResolvedValueOnce(jsonResponse({ onus: [{ id: 11, phy_addr: "SN2", slot: 0, pon: 0 }] }));

      const conn = createSgpConnector(creds);
      const onus = await conn.listarOnusNaoAutorizadas("3");

      expect(onus).toHaveLength(1);
      expect(onus[0].serial).toBe("SN2");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/fttx/onu/unauthorized/");
      expect(new URLSearchParams(fetchMock.mock.calls[1][1].body as string).get("olt_id")).toBe("3");
    });

    it("listarOnusAutorizadas passa contrato como query e mapeia service_cliente/service_contrato", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          onus: [{ id: 5, phy_addr: "SN9", slot: 1, pon: 1, service_contrato: 1268, service_cliente: "MARIA", info_rx: "-20" }],
        }),
      );

      const conn = createSgpConnector(creds);
      const [onu] = await conn.listarOnusAutorizadas("3", { contrato: "1268" });

      expect(onu.contrato).toBe("1268");
      expect(onu.clienteNome).toBe("MARIA");
      expect(onu.sinalRxDbm).toBeCloseTo(-20);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/fttx/olt/3/onu/list/");
      expect(String(fetchMock.mock.calls[0][0])).toContain("contrato=1268");
    });

    it("provisionarOnu faz POST /api/fttx/olt/:id/auth/ com slot/pon/id/onutype/mode no corpo", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ msg: "ONU autorizada", id: 77 }));

      const conn = createSgpConnector(creds);
      const r = await conn.provisionarOnu("3", {
        slot: "1",
        pon: "2",
        serial: "HWTC1",
        onutype: "HG8310",
        mode: 2,
        vlan: 100,
        service: "500",
        pppoeLogin: "cliente",
        pppoeSenha: "s3nha",
        contrato: "1268",
        descricao: "Instalacao",
        ident: "CTO-05",
      });

      expect(r).toEqual({ ok: true, mensagem: "ONU autorizada", onuId: "77" });

      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/fttx/olt/3/auth/");
      expect(options.method).toBe("POST");
      const body = new URLSearchParams(options.body as string);
      expect(body.get("slot")).toBe("1");
      expect(body.get("pon")).toBe("2");
      // serial -> "id" no corpo do SGP
      expect(body.get("id")).toBe("HWTC1");
      expect(body.get("onutype")).toBe("HG8310");
      expect(body.get("mode")).toBe("2");
      expect(body.get("service")).toBe("500");
      expect(body.get("pppoe_login")).toBe("cliente");
      expect(body.get("ident")).toBe("CTO-05");
      expect(body.get("app")).toBe(creds.app);
      expect(body.get("token")).toBe(creds.token);
    });

    it("provisionarOnu omite onutype quando ausente (o SGP detecta o modelo pelo SN)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ msg: "ONU autorizada" }));

      const conn = createSgpConnector(creds);
      await conn.provisionarOnu("3", { slot: "1", pon: "1", serial: "SN-AUTOFIND", mode: 1 });

      const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
      expect(body.has("onutype")).toBe(false);
      expect(body.get("id")).toBe("SN-AUTOFIND");
      expect(body.get("mode")).toBe("1");
    });

    it("provisionarOnu rejeita quando o SGP recusa a autorizacao (erro no corpo, HTTP 200)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ erro: "Serial ja autorizado" }));

      const conn = createSgpConnector(creds);
      await expect(
        conn.provisionarOnu("3", { slot: "1", pon: "2", serial: "X", onutype: "T", mode: 1 }),
      ).rejects.toThrow(/Serial ja autorizado/);
    });

    it("desautorizarOnu bate em /api/fttx/onu/:id/deauth/", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ msg: "ONU removida" }));

      const conn = createSgpConnector(creds);
      const r = await conn.desautorizarOnu("77");

      expect(r.ok).toBe(true);
      expect(r.mensagem).toBe("ONU removida");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/fttx/onu/77/deauth/");
    });

    it("redigirSegredosFttx mascara senha PPPoE/Wi-Fi e token, preservando o resto", () => {
      const red = redigirSegredosFttx({
        id: "SN123",
        pppoe_login: "user",
        pppoe_password: "s3nha",
        wifi_password: "wpa2",
        token: "tok-secreto",
        slot: "1",
      });

      expect(red.pppoe_password).toBe("***");
      expect(red.wifi_password).toBe("***");
      expect(red.token).toBe("***");
      // nao-segredos preservados
      expect(red.pppoe_login).toBe("user");
      expect(red.id).toBe("SN123");
      expect(red.slot).toBe("1");
    });
  });
});

describe("mensagem de negocio do SGP", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const casos: [string, string, string][] = [
    ["msg (formato real do 422 de encerrar)", '{"msg":"É necessário haver ao menos 2 foto(s) para encerrar o chamado"}', "É necessário haver ao menos 2 foto(s) para encerrar o chamado"],
    ["erro", '{"erro":"Contrato bloqueado"}', "Contrato bloqueado"],
    ["detail (DRF)", '{"detail":"Não encontrado."}', "Não encontrado."],
  ];

  for (const [nome, corpo, esperado] of casos) {
    it(`extrai a frase de ${nome}`, async () => {
      fetchMock.mockResolvedValueOnce(new Response(corpo, { status: 422 }));

      // A frase de negocio e o que interessa a quem esta em campo — ela ja diz
      // o que fazer. Fica em CAMPO no erro, nao so embutida no texto (a
      // mensagem tem URL, com `:` e `//`, e regex ali seria fragil).
      const erro = await createSgpConnector(creds)
        .updateOsStatus("6755", 1)
        .then(() => null)
        .catch((e) => e);

      expect(erro).toBeInstanceOf(SgpError);
      expect(erro.status).toBe(422);
      expect(erro.mensagemNegocio).toBe(esperado);
    });
  }

  it("corpo nao-JSON: sem frase de negocio (nao inventa)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const erro = await createSgpConnector(creds)
      .updateOsStatus("1", 1)
      .then(() => null)
      .catch((e) => e);

    expect(erro.mensagemNegocio).toBeUndefined();
    expect(erro.status).toBe(502);
  });

  it("403 de corpo vazio (o caso do /acaminho/) nao gera frase falsa", async () => {
    // Response NOVA por chamada: setOnTheWay tenta JSON e cai pro form, e
    // corpo de Response so pode ser lido uma vez.
    fetchMock.mockImplementation(async () => new Response("", { status: 403 }));

    const erro = await createSgpConnector(creds)
      .setOnTheWay("5326")
      .then(() => null)
      .catch((e) => e);

    expect(erro.mensagemNegocio).toBeUndefined();
    expect(erro.status).toBe(403);
  });
});

describe("obterFichaOs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Payload literal da doc "Ordem de Servico por ID" (array com 1 item). */
  const RESPOSTA_DOC = [
    {
      cliente_id: 1,
      os_status: 1,
      os_observacao: "OS_OBSERVACAO",
      endereco_complemento: "ENDERECO_COMPLEMENTO",
      os_servicoprestado: "OS_SERVICO_PRESTADO",
      plano: "PLANO",
      servico_online: true,
      endereco_pontoreferencia: "ENDERECO_PONTO_REFERENCIA",
      servico_ip: "999.99.99.99",
      servico_online_ip: "888.88.88.88",
      servico_login: "SERVICO_LOGIN",
      servico_mac: "X9:9X:X9:X9:99:99",
      servico_online_mac: "AA:BB:CC:DD:EE:FF",
      plano_download: "99999kbps",
      plano_upload: "88888kbps",
      servico_password: "SERVICO_PASSWORD",
      os_djson: {},
      cliente_contato: "9999999999, 99999999999",
      os_tecnico_responsavel: "TECNICO_RESPONSAVEL",
      os_tecnicos_auxiliares: ["TECNICO_1", "TECNICO_2"],
      os_setor: "SETOR",
      os_close_edit: false,
      os_encerrada_impedir_estorno: true,
    },
  ];

  it("extrai a ficha do payload real da doc", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RESPOSTA_DOC));

    const ficha = await createSgpConnector(creds).obterFichaOs("6755");

    expect(ficha).toEqual({
      // Sem contratoId nao ha consulta ao cadastro, entao o que vier e o da OS.
      clienteNome: null,
      clienteDocumento: null,
      clienteEmail: null,
      contratoStatus: null,
      sinalRxDbm: null,
      sinalTxDbm: null,
      oltNome: null,
      plano: "PLANO",
      planoDownload: "99999kbps",
      planoUpload: "88888kbps",
      servicoLogin: "SERVICO_LOGIN",
      servicoSenha: "SERVICO_PASSWORD",
      servicoOnline: true,
      // Prefere o da sessao ATIVA ao cadastrado — e o que vale em campo.
      servicoIp: "888.88.88.88",
      servicoMac: "AA:BB:CC:DD:EE:FF",
      enderecoComplemento: "ENDERECO_COMPLEMENTO",
      enderecoPontoReferencia: "ENDERECO_PONTO_REFERENCIA",
      servicoPrestado: "OS_SERVICO_PRESTADO",
      observacao: "OS_OBSERVACAO",
      tecnicoResponsavel: "TECNICO_RESPONSAVEL",
      tecnicosAuxiliares: ["TECNICO_1", "TECNICO_2"],
      setor: "SETOR",
      clienteContato: "9999999999, 99999999999",
    });
  });

  it("NAO expoe flags internas nem os_djson (ruido pro tecnico)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RESPOSTA_DOC));

    const ficha = (await createSgpConnector(creds).obterFichaOs("6755")) as unknown as Record<string, unknown>;

    for (const k of ["os_djson", "os_close_edit", "os_encerrada_impedir_estorno", "cliente_id", "os_status"]) {
      expect(ficha[k]).toBeUndefined();
    }
  });

  it("array vazio (SGP nao conhece a OS): null, nao objeto vazio", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    expect(await createSgpConnector(creds).obterFichaOs("999")).toBeNull();
  });

  it("cai pro IP/MAC cadastrado quando nao ha sessao ativa", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ servico_ip: "10.0.0.1", servico_mac: "11:22:33:44:55:66", servico_online: false }]),
    );

    const ficha = await createSgpConnector(creds).obterFichaOs("1");

    expect(ficha?.servicoIp).toBe("10.0.0.1");
    expect(ficha?.servicoMac).toBe("11:22:33:44:55:66");
    expect(ficha?.servicoOnline).toBe(false);
  });

  it("servico_online ausente vira null (indeterminado), nao false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ plano: "P" }]));
    const ficha = await createSgpConnector(creds).obterFichaOs("1");
    expect(ficha?.servicoOnline).toBeNull();
    expect(ficha?.tecnicosAuxiliares).toEqual([]);
  });

  it("manda app+token no corpo e bate no caminho documentado", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RESPOSTA_DOC));

    await createSgpConnector(creds).obterFichaOs("6755");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/os/list/id/6755/");
    expect(options.method).toBe("POST");
    const body = new URLSearchParams(options.body as string);
    expect(body.get("app")).toBe(creds.app);
    expect(body.get("token")).toBe(creds.token);
  });
});

describe("listServiceOrders — paginacao", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function pagina(qtd: number, total: number, primeiroId = 0) {
    return jsonResponse({
      paginacao: { total },
      ordens_servicos: Array.from({ length: qtd }, (_, i) => ({ os_id: String(primeiroId + i), os_status: 0 })),
    });
  }

  it("segue TODAS as paginas — antes tudo alem da 1a nunca sincronizava", async () => {
    // Era a causa do "mostrava aqui mas no SGP ja nao estava": a OS ficava
    // congelada no espelho e a acao nela batia em 404.
    fetchMock
      .mockResolvedValueOnce(pagina(200, 450, 0))
      .mockResolvedValueOnce(pagina(200, 450, 200))
      .mockResolvedValueOnce(pagina(50, 450, 400));

    const { itens: ordens } = await createSgpConnector(creds).listServiceOrders({ status: 0 });

    expect(ordens).toHaveLength(450);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // offset avanca de pagina em pagina
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).offset).toBe(0);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).offset).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string).offset).toBe(400);
  });

  it("manda `limit` explicito — sem ele o espelho dependia do default nao documentado do SGP", async () => {
    fetchMock.mockResolvedValueOnce(pagina(1, 1));
    await createSgpConnector(creds).listServiceOrders();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).limit).toBe(200);
  });

  it("pagina incompleta encerra (instancia que nao anuncia paginacao)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ordens_servicos: [{ os_id: "1", os_status: 0 }] }));
    const { itens: ordens } = await createSgpConnector(creds).listServiceOrders();
    expect(ordens).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("`offset` explicito respeita a janela pedida e NAO pagina", async () => {
    fetchMock.mockResolvedValueOnce(pagina(200, 999, 0));
    const { itens: ordens } = await createSgpConnector(creds).listServiceOrders({ offset: 0, limit: 200 });
    expect(ordens).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("total ja alcancado encerra mesmo com pagina cheia", async () => {
    fetchMock.mockResolvedValueOnce(pagina(200, 200, 0));
    await createSgpConnector(creds).listServiceOrders();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /*
   * `completo` e o campo que a reconciliacao de status usa pra decidir se
   * pode confiar na AUSENCIA de uma OS numa varredura — uma varredura
   * incompleta jamais pode virar "essa OS sumiu, cancela". Ver syncService.ts.
   */
  it("completo=true quando a varredura termina normalmente", async () => {
    fetchMock.mockResolvedValueOnce(pagina(200, 200, 0));
    const { completo, total } = await createSgpConnector(creds).listServiceOrders();
    expect(completo).toBe(true);
    expect(total).toBe(200);
  });

  it("completo=false ao bater no teto de paginas com mais coisa por vir", async () => {
    // PAGINACAO_MAX_PAGINAS=50 * PAGINA_OS(default)=200: simula um total bem
    // maior que 50 paginas cheias, entao o laco bate o teto sem terminar.
    for (let i = 0; i < 50; i++) fetchMock.mockResolvedValueOnce(pagina(200, 999_999, i * 200));

    const { itens, completo, total } = await createSgpConnector(creds).listServiceOrders();

    expect(completo).toBe(false);
    expect(total).toBe(999_999);
    expect(itens).toHaveLength(50 * 200);
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it("offset explicito (janela pontual) sempre reporta completo=true", async () => {
    fetchMock.mockResolvedValueOnce(pagina(200, 999, 0));
    const { completo } = await createSgpConnector(creds).listServiceOrders({ offset: 0, limit: 200 });
    expect(completo).toBe(true);
  });

  /*
   * Registro sem os_id/id: a chave do upsert e provedorId+sgpOsId, e
   * `String(undefined)` viraria a string literal "null" — varias OS
   * distintas colapsando na mesma linha do banco. Tem que ser descartado,
   * nao gravado com um id fabricado.
   */
  it("descarta registro sem os_id nem id, sem derrubar os demais", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ordens_servicos: [{ os_id: "1", os_status: 0 }, { os_status: 2 }, { os_id: "3", os_status: 0 }],
      }),
    );
    const { itens } = await createSgpConnector(creds).listServiceOrders();
    expect(itens.map((o) => o.sgpOsId)).toEqual(["1", "3"]);
  });
});

describe("obterFichaOs — PPPoE vem do CADASTRO do contrato", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Descoberto comparando com o app da CITmax: o login PPPoE real e o
   * `servico_login` do cadastro, nao o do endpoint da OS — que em varias
   * instancias vem vazio. Buscar so na OS era o motivo de a ficha vir sem
   * PPPoE.
   */
  const OS_SEM_PPPOE = [{ os_id: 1, os_observacao: "obs" }];

  const CADASTRO = {
    clientes: [
      {
        nome: "SERGIMARA FLORENCO DO NASCIMENTO",
        cpfcnpj: "12345678900",
        email: "cliente@exemplo.com",
        telefone: "84999998888",
        contratos: [
          {
            contratoStatusDisplay: "Ativo",
            contratoCentralLogin: "central-fallback",
            servicos: [
              {
                servico_login: "pppoe-real",
                servico_password: "senha-real",
                servico_plano: "FIBRA 500MB",
                onu: { rx: "-21.5", tx: "2.1", olt_nome: "OLT-HW-RN" },
              },
            ],
          },
        ],
      },
    ],
  };

  it("com contrato: le PPPoE, plano, sinal e dados do assinante do cadastro", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(OS_SEM_PPPOE))
      .mockResolvedValueOnce(jsonResponse(CADASTRO));

    const ficha = await createSgpConnector(creds).obterFichaOs("6755", "1672");

    expect(ficha?.servicoLogin).toBe("pppoe-real");
    expect(ficha?.servicoSenha).toBe("senha-real");
    expect(ficha?.plano).toBe("FIBRA 500MB");
    expect(ficha?.clienteNome).toBe("SERGIMARA FLORENCO DO NASCIMENTO");
    expect(ficha?.clienteDocumento).toBe("12345678900");
    expect(ficha?.clienteEmail).toBe("cliente@exemplo.com");
    expect(ficha?.contratoStatus).toBe("Ativo");
    expect(ficha?.sinalRxDbm).toBeCloseTo(-21.5);
    expect(ficha?.sinalTxDbm).toBeCloseTo(2.1);
    expect(ficha?.oltNome).toBe("OLT-HW-RN");
    expect(ficha?.clienteContato).toBe("84999998888");
  });

  it("servico_login tem PRIORIDADE sobre contratoCentralLogin (login da central nao e PPPoE)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OS_SEM_PPPOE)).mockResolvedValueOnce(jsonResponse(CADASTRO));
    const ficha = await createSgpConnector(creds).obterFichaOs("6755", "1672");
    expect(ficha?.servicoLogin).toBe("pppoe-real");
    expect(ficha?.servicoLogin).not.toBe("central-fallback");
  });

  it("sem servico_login, cai pro contratoCentralLogin", async () => {
    const semServicoLogin = {
      clientes: [{ contratos: [{ contratoCentralLogin: "central-fallback", servicos: [{}] }] }],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(OS_SEM_PPPOE)).mockResolvedValueOnce(jsonResponse(semServicoLogin));
    const ficha = await createSgpConnector(creds).obterFichaOs("6755", "1672");
    expect(ficha?.servicoLogin).toBe("central-fallback");
  });

  it("cadastro fora do ar NAO derruba a ficha — a parte da OS continua vindo", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(OS_SEM_PPPOE))
      .mockResolvedValueOnce(new Response("", { status: 500 }));

    const ficha = await createSgpConnector(creds).obterFichaOs("6755", "1672");

    expect(ficha).not.toBeNull();
    expect(ficha?.observacao).toBe("obs");
    expect(ficha?.servicoLogin).toBeNull();
  });

  it("sem contrato: nao consulta o cadastro (1 chamada so)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OS_SEM_PPPOE));
    await createSgpConnector(creds).obterFichaOs("6755", null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("as duas consultas usam a URL e o token do MESMO provedor", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OS_SEM_PPPOE)).mockResolvedValueOnce(jsonResponse(CADASTRO));

    await createSgpConnector(creds).obterFichaOs("6755", "1672");

    for (const [url, options] of fetchMock.mock.calls) {
      expect(String(url)).toContain("https://sgp.exemplo.com.br/");
      expect(new URLSearchParams(options.body as string).get("token")).toBe(creds.token);
    }
  });
});

describe("obterStatusOs — a pergunta ESTRITA (usada pra reconciliar OS fora da fila de abertas)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * O contrato de erro deste metodo e a unica coisa entre uma instabilidade do
   * SGP e a fila do provedor sendo cancelada em massa: a reconciliacao de
   * status marca OS como CANCELADA quando ele responde `null`. Por isso erro
   * de transporte PRECISA propagar — quem chama trata como "sem evidencia".
   *
   * Era `osExisteNoSgp(): boolean` — respondia "sim, existe" pra OS fechada
   * (que existe, so nao esta mais aberta), e o chamador antigo tratava "existe"
   * como "nao mexe". Por isso OS fechada no SGP nunca saia da fila do ISPhub.
   */
  it("resposta vazia e bem-sucedida => null (a OS realmente nao esta la)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ordens_servicos: [] }));
    expect(await createSgpConnector(creds).obterStatusOs("999")).toBeNull();
  });

  it("OS encontrada => devolve o status bruto (nao um booleano)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ os_id: 6755, os_status: 1 }]));
    expect(await createSgpConnector(creds).obterStatusOs("6755")).toBe(1);
  });

  it("OS encontrada so com rotulo textual => devolve o texto", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ os_id: 6755, status: "Encerrada" }]));
    expect(await createSgpConnector(creds).obterStatusOs("6755")).toBe("Encerrada");
  });

  it("erro 500 PROPAGA — nunca vira `null`, senao o sync cancelaria OS viva", async () => {
    fetchMock.mockResolvedValueOnce(new Response("erro interno", { status: 500 }));
    await expect(createSgpConnector(creds).obterStatusOs("6755")).rejects.toThrow();
  });

  it("timeout/rede fora PROPAGA — mesma razao", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(createSgpConnector(creds).obterStatusOs("6755")).rejects.toThrow();
  });
});

describe("obterFichaOs — a pergunta TOLERANTE: uma fonte nao derruba a outra", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const CADASTRO = {
    clientes: [
      {
        nome: "CLIENTE COM CADASTRO",
        contratos: [{ servicos: [{ servico_login: "pppoe-real", servico_plano: "FIBRA 500MB" }] }],
      },
    ],
  };

  /**
   * O defeito que gerou a pergunta "porque ta aparecendo: Esta OS nao existe
   * mais no SGP?". `/api/os/` e outra familia de API que a do sync
   * (`/api/ura/`): pode nao estar liberada na instancia, ou nao devolver OS
   * encerrada. Um `if (!item) return null` jogava fora o cadastro que tinha
   * chegado inteiro — PPPoE, cliente, sinal — e o cliente afirmava que a OS
   * havia sido apagada.
   */
  it("endpoint da OS fora do ar, cadastro OK => ficha vem com o que deu", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nao habilitado", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(CADASTRO));

    const ficha = await createSgpConnector(creds).obterFichaOs("6755", "1672");

    expect(ficha).not.toBeNull();
    expect(ficha?.servicoLogin).toBe("pppoe-real");
    expect(ficha?.plano).toBe("FIBRA 500MB");
    expect(ficha?.clienteNome).toBe("CLIENTE COM CADASTRO");
    // Campos que so existem no endpoint da OS ficam null, nao quebram nada.
    expect(ficha?.observacao).toBeNull();
    expect(ficha?.servicoOnline).toBeNull();
  });

  it("OS responde vazio (ex.: encerrada), cadastro OK => ficha vem", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ordens_servicos: [] })).mockResolvedValueOnce(jsonResponse(CADASTRO));
    const ficha = await createSgpConnector(creds).obterFichaOs("6755", "1672");
    expect(ficha?.servicoLogin).toBe("pppoe-real");
  });

  it("as DUAS fontes vazias => null (e so aqui o cliente diz que nao veio nada)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ordens_servicos: [] }))
      .mockResolvedValueOnce(jsonResponse({ clientes: [] }));
    expect(await createSgpConnector(creds).obterFichaOs("6755", "1672")).toBeNull();
  });

  it("cadastro fora do ar, OS OK => ficha vem pela OS", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ os_id: 1, os_observacao: "obs da OS" }]))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const ficha = await createSgpConnector(creds).obterFichaOs("1", "1672");
    expect(ficha?.observacao).toBe("obs da OS");
  });
});

describe("plano como OBJETO — o bug do \"[object Object]\" na tela", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const comPlano = (servicoPlano: unknown) => ({
    clientes: [{ contratos: [{ servicos: [{ servico_plano: servicoPlano }] }] }],
  });

  async function ficha(servicoPlano: unknown) {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ordens_servicos: [] }))
      .mockResolvedValueOnce(jsonResponse(comPlano(servicoPlano)));
    return createSgpConnector(creds).obterFichaOs("1", "30105");
  }

  it("objeto: usa o nome de dentro, nunca \"[object Object]\"", async () => {
    const f = await ficha({ id: 7, nome: "FIBRA 300MB", download: "300 Mbps", upload: "150 Mbps" });
    expect(f?.plano).toBe("FIBRA 300MB");
    expect(f?.planoDownload).toBe("300 Mbps");
    expect(f?.planoUpload).toBe("150 Mbps");
  });

  it("string: continua funcionando", async () => {
    expect((await ficha("FIBRA 500MB"))?.plano).toBe("FIBRA 500MB");
  });

  it("objeto sem chave de nome reconhecida => null, nao lixo na tela", async () => {
    const f = await ficha({ id: 7, codigo_interno: 99 });
    expect(f?.plano).toBeNull();
  });

  it("nenhum campo do SGP vira \"[object Object]\" — a guarda e no pickString", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ os_id: 1, os_observacao: { texto: "objeto onde devia ser texto" }, plano: { a: 1 } }]),
      )
      .mockResolvedValueOnce(jsonResponse({ clientes: [] }));

    const f = (await createSgpConnector(creds).obterFichaOs("1", "30105")) as unknown as Record<string, unknown>;

    for (const [campo, valor] of Object.entries(f)) {
      expect(String(valor), `campo ${campo}`).not.toContain("[object Object]");
    }
  });
});
