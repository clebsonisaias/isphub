import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OS DO PROVEDOR X SAI COM A URL, O APP E O TOKEN DO X.
 *
 * O teste de writebackService prova que a LINHA de config certa e escolhida,
 * mas ele mocka o buildConnector — nao prova que os tres campos daquela linha
 * chegam na requisicao. Este aqui fecha o outro lado: config real -> conector
 * real -> `fetch` observado. Sem ele, trocar `creds.app` por uma constante ou
 * reaproveitar um `baseUrl` de outro provedor passaria despercebido, e a
 * escrita de um cliente cairia na base de outro.
 */

// Token "decifrado" = o cifrado sem o prefixo, so pra distinguir os provedores.
vi.mock("../lib/crypto.js", () => ({
  decrypt: (cifrado: string) => cifrado.replace("cif:", ""),
}));

const { buildConnector } = await import("./erpConnectorService.js");

const CONFIG_X = { tipo: "SGP", url: "https://sgp-x.com.br", app: "app-do-x", tokenCifrado: "cif:token-do-x" };
const CONFIG_Y = { tipo: "SGP", url: "https://sgp-y.com.br/", app: "app-do-y", tokenCifrado: "cif:token-do-y" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Response NOVA a cada chamada: o corpo so pode ser lido uma vez, entao
  // reaproveitar a mesma instancia quebra da segunda requisicao em diante.
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

/**
 * Extrai o que de fato foi pra rede na ultima chamada. Le JSON e form: o SGP
 * usa os dois conforme o endpoint, e o que este teste certifica e a
 * CREDENCIAL, nao o formato.
 */
function requisicao() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  const { body, headers } = init as RequestInit;
  const tipo = (headers as Record<string, string> | undefined)?.["Content-Type"] ?? "";
  const corpo = tipo.includes("json")
    ? (JSON.parse(String(body)) as Record<string, string>)
    : Object.fromEntries(new URLSearchParams(String(body)));
  return { url: String(url), app: corpo.app ?? null, token: corpo.token ?? null };
}

describe("credenciais por provedor chegam na requisicao", () => {
  it("provedor X: url, app e token do X", async () => {
    await buildConnector(CONFIG_X).setOnTheWay("5326");
    const r = requisicao();
    expect(r.url).toBe("https://sgp-x.com.br/api/os/acaminho/id/5326/");
    expect(r.app).toBe("app-do-x");
    expect(r.token).toBe("token-do-x");
  });

  it("provedor Y: url, app e token do Y — nada do X vaza", async () => {
    await buildConnector(CONFIG_Y).setOnTheWay("77");
    const r = requisicao();
    expect(r.url).toBe("https://sgp-y.com.br/api/os/acaminho/id/77/");
    expect(r.app).toBe("app-do-y");
    expect(r.token).toBe("token-do-y");
    expect(r.url).not.toContain("sgp-x");
    expect(r.app).not.toBe("app-do-x");
    expect(r.token).not.toBe("token-do-x");
  });

  it("alternando X e Y na mesma execucao, cada um mantem as SUAS credenciais", async () => {
    const x = buildConnector(CONFIG_X);
    const y = buildConnector(CONFIG_Y);

    await x.setOnTheWay("1");
    const rx1 = requisicao();
    await y.setOnTheWay("2");
    const ry = requisicao();
    await x.setOnTheWay("3");
    const rx2 = requisicao();

    expect(rx1.token).toBe("token-do-x");
    expect(ry.token).toBe("token-do-y");
    // O X depois do Y continua sendo o X (nenhum estado de modulo compartilhado).
    expect(rx2.token).toBe("token-do-x");
    expect(rx2.url).toContain("sgp-x");
  });

  it("a barra final da url do provedor nao vira barra dupla no caminho", async () => {
    await buildConnector(CONFIG_Y).setOnTheWay("77");
    expect(requisicao().url).not.toContain("//api/");
  });

  it("o token NUNCA vai na URL (nao vaza em log de proxy/access log)", async () => {
    await buildConnector(CONFIG_X).setOnTheWay("5326");
    expect(requisicao().url).not.toContain("token-do-x");
  });
});

describe("outras escritas usam as mesmas credenciais do provedor", () => {
  it("anotacao do provedor Y sai na base do Y", async () => {
    await buildConnector(CONFIG_Y).addOsNote("77", "instalado");
    const r = requisicao();
    expect(r.url).toContain("https://sgp-y.com.br/");
    expect(r.token).toBe("token-do-y");
  });

  it("tipo de ERP desconhecido nao monta conector nenhum", () => {
    expect(() => buildConnector({ ...CONFIG_X, tipo: "OUTRO" })).toThrow(/nao suportado/i);
  });
});
