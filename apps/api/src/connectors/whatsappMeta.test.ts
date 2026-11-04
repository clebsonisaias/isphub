import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enviarBotoes,
  enviarTemplate,
  extrairVariaveis,
  limparCacheTemplates,
  listarTemplates,
  montarComponents,
  normalizarTelefoneBR,
  obterTemplate,
  renderizarTemplate,
  sanitizarVariavel,
  type TemplateWhatsappDef,
} from "./whatsappMeta.js";

const config = { phoneNumberId: "1112223334", accessToken: "tok-meta-abc" };
const WABA_ID = "998877";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Forma do payload real do GET /{wabaId}/message_templates. */
function templateBruto(over: Record<string, unknown> = {}) {
  return {
    name: "aviso_visita",
    status: "APPROVED",
    category: "UTILITY",
    language: "pt_BR",
    components: [{ type: "BODY", text: "Ola {{1}}, sua visita e {{2}}." }],
    ...over,
  };
}

function def(over: Partial<TemplateWhatsappDef> = {}): TemplateWhatsappDef {
  return {
    nome: "aviso_visita",
    idioma: "pt_BR",
    categoria: "UTILITY",
    corpo: "Ola {{1}}, sua visita e {{2}}.",
    header: null,
    variaveis: [1, 2],
    ...over,
  };
}

describe("extrairVariaveis", () => {
  it("ordena e remove repeticao dos indices {{n}}", () => {
    expect(extrairVariaveis("Ola {{2}}, confirmando {{1}} para {{2}}.")).toEqual([1, 2]);
  });

  it("devolve vazio quando nao ha placeholder", () => {
    expect(extrairVariaveis("Mensagem fixa, sem variavel.")).toEqual([]);
  });

  it("ignora chaves que nao sao {{numero}}", () => {
    expect(extrairVariaveis("{{nome}} {{ 1 }} {{3}}")).toEqual([3]);
  });
});

describe("sanitizarVariavel", () => {
  it("colapsa quebra de linha, tab e espacos multiplos (a Meta recusa com #131009)", () => {
    expect(sanitizarVariavel("Maria\nSilva\tJose    Souza")).toBe("Maria Silva Jose Souza");
  });

  it("apara as pontas", () => {
    expect(sanitizarVariavel("  Joao  ")).toBe("Joao");
  });

  it("cai para 'cliente' quando o valor e vazio, so espaco, ou nem veio", () => {
    expect(sanitizarVariavel("")).toBe("cliente");
    expect(sanitizarVariavel("   \n ")).toBe("cliente");
    expect(sanitizarVariavel(undefined)).toBe("cliente");
    expect(sanitizarVariavel(null)).toBe("cliente");
  });
});

describe("montarComponents", () => {
  it("monta o body com os parametros na ordem dos indices, ja sanitizados", () => {
    expect(montarComponents(def(), { "1": "Maria\nSilva", "2": "10/08" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Maria Silva" }, { type: "text", text: "10/08" }] },
    ]);
  });

  it("inclui o header de texto antes do body", () => {
    const componentes = montarComponents(def({ header: "Visita {{1}}", variaveis: [1, 2] }), { "1": "agendada", "2": "10/08" });

    expect(componentes.map((c) => c.type)).toEqual(["header", "body"]);
    expect(componentes[0].parameters).toEqual([{ type: "text", text: "agendada" }]);
  });

  it("pula o componente sem placeholder — mandar parameters nele da erro #132000", () => {
    const componentes = montarComponents(def({ header: "Aviso da CITmax", corpo: "Sua visita foi confirmada.", variaveis: [] }), {});

    expect(componentes).toEqual([]);
  });

  it("pula so o header quando ele e fixo e o corpo tem variavel", () => {
    const componentes = montarComponents(def({ header: "Aviso da CITmax", corpo: "Ola {{1}}.", variaveis: [1] }), { "1": "Ana" });

    expect(componentes).toEqual([{ type: "body", parameters: [{ type: "text", text: "Ana" }] }]);
  });

  it("preenche os indices ausentes quando o texto pula um numero (parametros sao posicionais)", () => {
    const componentes = montarComponents(def({ corpo: "Protocolo {{3}}", variaveis: [3] }), { "3": "A1" });

    expect(componentes[0].parameters).toEqual([
      { type: "text", text: "cliente" },
      { type: "text", text: "cliente" },
      { type: "text", text: "A1" },
    ]);
  });
});

describe("renderizarTemplate", () => {
  it("substitui os {{n}} pelos mesmos valores sanitizados que vao no payload", () => {
    expect(renderizarTemplate(def(), { "1": "Maria  Silva", "2": "10/08" })).toBe("Ola Maria Silva, sua visita e 10/08.");
  });

  it("junta header e corpo, nessa ordem", () => {
    const texto = renderizarTemplate(def({ header: "Visita {{1}}", corpo: "Ate logo, {{2}}." }), { "1": "agendada", "2": "Ana" });

    expect(texto).toBe("Visita agendada\n\nAte logo, Ana.");
  });

  it("usa o mesmo fallback do payload quando a variavel nao veio", () => {
    expect(renderizarTemplate(def(), { "2": "10/08" })).toBe("Ola cliente, sua visita e 10/08.");
  });
});

describe("normalizarTelefoneBR", () => {
  it("tira mascara e prefixa o DDI 55", () => {
    expect(normalizarTelefoneBR("(84) 99999-8888")).toBe("5584999998888");
  });

  it("descarta o 0 de operadora antes do DDD", () => {
    expect(normalizarTelefoneBR("084 99999-8888")).toBe("5584999998888");
  });

  it("injeta o 9o digito em celular antigo (12 digitos sem o 9)", () => {
    expect(normalizarTelefoneBR("5584 8888-7777")).toBe("5584988887777");
  });

  it("nao mexe em numero ja normalizado (idempotente)", () => {
    expect(normalizarTelefoneBR("5584999998888")).toBe("5584999998888");
    expect(normalizarTelefoneBR(normalizarTelefoneBR("5584 8888-7777"))).toBe("5584988887777");
  });

  // Regressao: decidir pelo prefixo tratava o DDD 55 como se fosse o DDI e
  // devolvia um numero de 11 digitos, que a validacao rejeitava — o atendente
  // via "Telefone invalido" pra um numero perfeitamente valido.
  it("nao confunde o DDD 55 (Santa Maria/RS) com o DDI", () => {
    expect(normalizarTelefoneBR("(55) 99123-4567")).toBe("5555991234567");
  });

  it("aceita o mesmo numero de DDD 55 ja escrito com DDI", () => {
    expect(normalizarTelefoneBR("+55 55 99123-4567")).toBe("5555991234567");
  });

  it("fixo de DDD 55 com 8 digitos vira 55+DDD+8 e ganha o 9o digito", () => {
    expect(normalizarTelefoneBR("(55) 3221-4567")).toBe("5555932214567");
  });
});

describe("catalogo e disparo (Graph API mockada)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    limparCacheTemplates();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    limparCacheTemplates();
  });

  it("listarTemplates mapeia o payload real e le o idioma da definicao aprovada", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          templateBruto({
            name: "confirmacao_visita",
            language: "pt_BR",
            components: [
              { type: "HEADER", format: "TEXT", text: "Visita {{1}}" },
              { type: "BODY", text: "Ola {{1}}, tudo certo para {{2}}?" },
              { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmar" }] },
            ],
          }),
        ],
      }),
    );

    const [template] = await listarTemplates(config, WABA_ID);

    expect(template.nome).toBe("confirmacao_visita");
    expect(template.idioma).toBe("pt_BR");
    expect(template.categoria).toBe("UTILITY");
    expect(template.header).toBe("Visita {{1}}");
    expect(template.corpo).toBe("Ola {{1}}, tudo certo para {{2}}?");
    // Uniao de header+corpo, sem repetir o {{1}} que aparece nos dois.
    expect(template.variaveis).toEqual([1, 2]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/${WABA_ID}/message_templates`);
    expect(String(url)).toContain("fields=name%2Cstatus%2Ccategory%2Clanguage%2Ccomponents");
    // Token vai no header, nunca na query (a URL vaza em log de proxy).
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.accessToken}`);
    expect(String(url)).not.toContain(config.accessToken);
  });

  it("listarTemplates ignora template nao aprovado e header de midia", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          templateBruto({ name: "aprovado" }),
          templateBruto({ name: "pendente", status: "PENDING" }),
          templateBruto({ name: "reprovado", status: "REJECTED" }),
          templateBruto({
            name: "com_imagem",
            components: [
              { type: "HEADER", format: "IMAGE", example: { header_handle: ["abc"] } },
              { type: "BODY", text: "Ola {{1}}." },
            ],
          }),
        ],
      }),
    );

    const templates = await listarTemplates(config, WABA_ID);

    expect(templates.map((t) => t.nome)).toEqual(["aprovado", "com_imagem"]);
    expect(templates[1].header).toBeNull();
  });

  it("listarTemplates segue a paginacao enquanto a Meta manda paging.next", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [templateBruto({ name: "pagina_1" })],
          paging: { cursors: { after: "CURSOR_1" }, next: "https://graph.facebook.com/v21.0/998877/message_templates?after=CURSOR_1" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [templateBruto({ name: "pagina_2" })], paging: { cursors: { after: "CURSOR_2" } } }));

    const templates = await listarTemplates(config, WABA_ID);

    expect(templates.map((t) => t.nome)).toEqual(["pagina_1", "pagina_2"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("after=CURSOR_1");
  });

  it("listarTemplates reusa o cache de 5 min por wabaId", async () => {
    // Response nova a cada chamada: o corpo de uma Response so pode ser lido uma vez.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [templateBruto()] })));

    await listarTemplates(config, WABA_ID);
    await listarTemplates(config, WABA_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    limparCacheTemplates(WABA_ID);
    await listarTemplates(config, WABA_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("listarTemplates lanca (sem chamar a Meta) quando o WABA ID nao esta configurado", async () => {
    await expect(listarTemplates(config, "")).rejects.toThrow(/WABA ID nao configurado/);
    await expect(listarTemplates(config, "   ")).rejects.toThrow(/WABA ID nao configurado/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listarTemplates propaga o erro da Meta com o corpo da resposta", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported get request" } }), { status: 400 }));

    await expect(listarTemplates(config, WABA_ID)).rejects.toThrow(/Unsupported get request/);
  });

  it("obterTemplate devolve null pro que nao esta aprovado — o chamador recusa em vez de chutar o payload", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ data: [templateBruto({ name: "so_esse" }), templateBruto({ name: "pausado", status: "PAUSED" })] })),
    );

    expect(await obterTemplate(config, WABA_ID, "so_esse")).not.toBeNull();
    expect(await obterTemplate(config, WABA_ID, "pausado")).toBeNull();
    expect(await obterTemplate(config, WABA_ID, "inexistente")).toBeNull();
  });

  it("enviarTemplate posta name/language/components e devolve o corpo renderizado", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.XYZ" }] }));

    const resultado = await enviarTemplate(config, "(84) 99999-8888", def({ idioma: "pt_PT" }), { "1": "Maria", "2": "10/08" });

    expect(resultado.ok).toBe(true);
    expect(resultado.waMessageId).toBe("wamid.XYZ");
    expect(resultado.corpoRenderizado).toBe("Ola Maria, sua visita e 10/08.");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/${config.phoneNumberId}/messages`);
    const body = JSON.parse(options.body as string);
    expect(body.type).toBe("template");
    expect(body.to).toBe("5584999998888");
    expect(body.template.name).toBe("aviso_visita");
    expect(body.template.language).toEqual({ code: "pt_PT" });
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "10/08" }] },
    ]);
  });

  it("enviarTemplate omite components quando o template nao tem placeholder", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.1" }] }));

    await enviarTemplate(config, "5584999998888", def({ corpo: "Sua visita foi confirmada.", variaveis: [] }), {});

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.template).not.toHaveProperty("components");
  });

  it("enviarTemplate devolve ok:false com o motivo da Meta, mantendo o corpo renderizado", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 132000, message: "(#132000) Number of parameters does not match" } }), { status: 400 }),
    );

    const resultado = await enviarTemplate(config, "5584999998888", def(), { "1": "Maria", "2": "10/08" });

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toContain("132000");
    expect(resultado.corpoRenderizado).toBe("Ola Maria, sua visita e 10/08.");
  });

  it("enviarTemplate recusa definicao sem idioma em vez de assumir pt_BR", async () => {
    await expect(enviarTemplate(config, "5584999998888", def({ idioma: "" }), {})).rejects.toThrow(/sem idioma/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("enviarBotoes", () => {
    it("monta payload de mensagem interativa com até 3 botões", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.btn1" }] }));

      const res = await enviarBotoes(
        config,
        "84 99999-8888",
        "Confirma sua visita?",
        [
          { id: "btn_1", titulo: "Sim, confirmar" },
          { id: "btn_2", titulo: "Quero reagendar" },
        ],
      );

      expect(res.ok).toBe(true);
      expect(res.waMessageId).toBe("wamid.btn1");

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain("/1112223334/messages");
      const body = JSON.parse(options.body as string);
      expect(body.type).toBe("interactive");
      expect(body.to).toBe("5584999998888");
      expect(body.interactive.type).toBe("button");
      expect(body.interactive.body.text).toBe("Confirma sua visita?");
      expect(body.interactive.action.buttons).toHaveLength(2);
      expect(body.interactive.action.buttons[0].reply.id).toBe("btn_1");
      expect(body.interactive.action.buttons[0].reply.title).toBe("Sim, confirmar");
    });
  });
});
