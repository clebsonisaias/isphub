import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapSgpOsStatus, OsStatus } from "@isphub/shared";
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
            os_tecnico_responsavel: "Joao Tecnico",
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
    const [os] = await conn.listServiceOrders();

    expect(os.contratoId).toBe("1268");
    expect(typeof os.contratoId).toBe("string");
    expect(os.tipoCodigo).toBe("1");
    expect(typeof os.tipoCodigo).toBe("string");
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
    const [encerrada, aberta] = await conn.listServiceOrders();

    expect(mapSgpOsStatus(encerrada.statusCode)).toBe(OsStatus.CONCLUIDA);
    expect(mapSgpOsStatus(aberta.statusCode)).toBe(OsStatus.ABERTA);
  });

  it("listServiceOrders ainda funciona quando o SGP so manda o rotulo textual (sem status_id)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ordens_servicos: [{ id: 99, status: "Encerrada", motivo: "Reparo" }] }),
    );

    const conn = createSgpConnector(creds);
    const [os] = await conn.listServiceOrders();

    expect(mapSgpOsStatus(os.statusCode)).toBe(OsStatus.CONCLUIDA);
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
});
