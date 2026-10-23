import { beforeEach, describe, expect, it, vi } from "vitest";

// Fakes em memoria. Os modulos reais (AsyncStorage, FileSystem) puxam codigo
// nativo, que nao existe fora do aparelho — por isso o mock, e nao um
// ambiente RN completo.
const memoria = new Map<string, string>();
const disco = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memoria.get(k) ?? null,
    setItem: async (k: string, v: string) => void memoria.set(k, v),
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (uri: string, v: string) => void disco.set(uri, v),
  readAsStringAsync: async (uri: string) => {
    if (!disco.has(uri)) throw new Error("ENOENT");
    return disco.get(uri)!;
  },
  deleteAsync: async (uri: string) => void disco.delete(uri),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
// `@/lib/auth` puxa biometria e push (nativos) e `@/lib/api` puxa
// expo-file-system — nenhum dos dois carrega em node.
const { ApiError } = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message = "erro",
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), baixarAnexoAutenticado: vi.fn(), ApiError }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ token: null }) }));
const { enviarEvidencia } = vi.hoisted(() => ({ enviarEvidencia: vi.fn() }));
vi.mock("./api", () => ({ enviarEvidencia }));

import {
  backoffMs,
  enfileirarEvidencia,
  listarPendentesDaOs,
  processarFila,
  recusaDefinitiva,
  registrarFalhaParaTeste,
  removerPendenteParaTeste,
  tentarDeNovo,
} from "./outbox";

const input = { dados: "AAAA", mimeType: "image/jpeg" as const };
const CHAVE = "isphub_evidencias_outbox";

describe("fila offline de evidencias", () => {
  beforeEach(() => {
    memoria.clear();
    disco.clear();
    enviarEvidencia.mockReset();
  });

  it("enfileira: indice no AsyncStorage SEM o base64, foto em arquivo proprio", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-2", input);

    const daUm = await listarPendentesDaOs("os-1");
    expect(daUm).toHaveLength(1);
    expect(daUm[0].osId).toBe("os-1");
    expect(daUm[0].falhou).toBe(false);
    expect(memoria.get(CHAVE)).not.toContain("AAAA");
    expect(disco.get(`file:///doc/evidencias-outbox/${a.localId}.jpg`)).toBe("AAAA");
  });

  it("gera localId unico por item", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    const b = await enfileirarEvidencia("os-1", input);
    expect(a.localId).not.toBe(b.localId);
  });

  it("remover tira so o item pedido e apaga o arquivo dele", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-1", input);
    await removerPendenteParaTeste(a.localId);

    const restantes = await listarPendentesDaOs("os-1");
    expect(restantes).toHaveLength(1);
    expect(restantes[0].localId).not.toBe(a.localId);
    expect(disco.size).toBe(1);
  });

  it("falha de rede/5xx/401 NAO marca falhou: agenda nova tentativa com backoff", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    await registrarFalhaParaTeste(a.localId, new TypeError("Network request failed"));
    let [p] = await listarPendentesDaOs("os-1");
    expect(p.falhou).toBe(false);
    expect(p.tentativas).toBe(1);
    expect(Date.parse(p.proximaEm!)).toBeGreaterThan(Date.now());

    await registrarFalhaParaTeste(a.localId, new ApiError(503));
    await registrarFalhaParaTeste(a.localId, new ApiError(401));
    [p] = await listarPendentesDaOs("os-1");
    expect(p.falhou).toBe(false);
    expect(p.tentativas).toBe(3);
  });

  it("recusa do servidor (4xx) marca falhou em vez de descartar; tentarDeNovo zera", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    await registrarFalhaParaTeste(a.localId, new ApiError(413));

    let [p] = await listarPendentesDaOs("os-1");
    expect(p.localId).toBe(a.localId);
    expect(p.falhou).toBe(true);
    expect(p.proximaEm).toBeUndefined();

    await tentarDeNovo(a.localId);
    [p] = await listarPendentesDaOs("os-1");
    expect(p.falhou).toBe(false);
    expect(p.tentativas).toBe(0);
  });

  it("backoff dobra a partir de 30s e para em 30min", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
    expect(recusaDefinitiva(new ApiError(400))).toBe(true);
    expect(recusaDefinitiva(new ApiError(429))).toBe(false);
    expect(recusaDefinitiva(new Error("rede"))).toBe(false);
  });

  it("processarFila envia, remove do indice e do disco; duas chamadas simultaneas nao duplicam", async () => {
    await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-1", input);
    enviarEvidencia.mockResolvedValue([]);

    await Promise.all([processarFila("tok"), processarFila("tok")]);

    expect(enviarEvidencia).toHaveBeenCalledTimes(2);
    expect(enviarEvidencia).toHaveBeenCalledWith("os-1", "tok", expect.objectContaining({ dados: "AAAA" }));
    expect(await listarPendentesDaOs("os-1")).toEqual([]);
    expect(disco.size).toBe(0);
  });

  it("pula item em backoff e envia item antigo (base64 inline) sem arquivo", async () => {
    memoria.set(
      CHAVE,
      JSON.stringify([
        { localId: "legado", osId: "os-9", input, criadoEm: "2026-01-01", falhou: false },
        { localId: "esperando", osId: "os-9", mimeType: "image/jpeg", criadoEm: "x", falhou: false, tentativas: 1, proximaEm: new Date(Date.now() + 60_000).toISOString() },
      ]),
    );
    enviarEvidencia.mockResolvedValue([]);

    await processarFila("tok");

    expect(enviarEvidencia).toHaveBeenCalledTimes(1);
    expect(enviarEvidencia).toHaveBeenCalledWith("os-9", "tok", expect.objectContaining({ dados: "AAAA" }));
    expect((await listarPendentesDaOs("os-9")).map((p) => p.localId)).toEqual(["esperando"]);
  });

  it("sobrevive a storage corrompido, devolvendo fila vazia", async () => {
    memoria.set(CHAVE, "{ isso nao e json");
    expect(await listarPendentesDaOs("os-1")).toEqual([]);
  });
});

describe("fila offline no navegador (PWA, sem sistema de arquivos)", () => {
  beforeEach(() => {
    memoria.clear();
    disco.clear();
    enviarEvidencia.mockReset();
  });

  it("guarda a foto no proprio registro, mostra como data: e envia dela", async () => {
    // documentDirectory nulo = navegador. Recarrega o modulo com esse FS.
    vi.resetModules();
    vi.doMock("expo-file-system/legacy", () => ({
      documentDirectory: null,
      EncodingType: { Base64: "base64" },
      makeDirectoryAsync: async () => {
        throw new Error("indisponivel no navegador");
      },
      writeAsStringAsync: async () => {
        throw new Error("indisponivel no navegador");
      },
      deleteAsync: async () => {
        throw new Error("indisponivel no navegador");
      },
    }));
    const web = await import("./outbox");

    const p = await web.enfileirarEvidencia("os-1", input);
    expect(disco.size).toBe(0);
    expect(web.uriDaPendente(p)).toBe("data:image/jpeg;base64,AAAA");

    enviarEvidencia.mockResolvedValue([]);
    await web.processarFila("tok");
    expect(enviarEvidencia).toHaveBeenCalledWith("os-1", "tok", expect.objectContaining({ dados: "AAAA" }));
    expect(await web.listarPendentesDaOs("os-1")).toEqual([]);
    vi.doUnmock("expo-file-system/legacy");
  });
});
