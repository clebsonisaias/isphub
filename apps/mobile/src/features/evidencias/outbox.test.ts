import { beforeEach, describe, expect, it, vi } from "vitest";

// Fakes em memoria. O modulo real do AsyncStorage puxa codigo nativo, que nao
// existe fora do aparelho — por isso o mock, e nao um ambiente RN completo.
const memoria = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memoria.get(k) ?? null,
    setItem: async (k: string, v: string) => void memoria.set(k, v),
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
// `@/lib/auth` puxa biometria e push (nativos) e `@/lib/api` puxa
// expo-file-system — nenhum dos dois carrega em node. O outbox importa os dois
// no topo, entao o mock e obrigatorio pro modulo sequer avaliar.
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), baixarAnexoAutenticado: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ token: null }) }));

import { enfileirarEvidencia, listarPendentesDaOs, marcarFalhouParaTeste, removerPendenteParaTeste } from "./outbox";

const input = { dados: "AAAA", mimeType: "image/jpeg" as const };

describe("fila offline de evidencias", () => {
  beforeEach(() => memoria.clear());

  it("enfileira e devolve a pendente da OS certa", async () => {
    await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-2", input);

    const daUm = await listarPendentesDaOs("os-1");
    expect(daUm).toHaveLength(1);
    expect(daUm[0].osId).toBe("os-1");
    expect(daUm[0].falhou).toBe(false);
  });

  it("gera localId unico por item", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    const b = await enfileirarEvidencia("os-1", input);
    expect(a.localId).not.toBe(b.localId);
  });

  it("remover tira so o item pedido", async () => {
    const a = await enfileirarEvidencia("os-1", input);
    await enfileirarEvidencia("os-1", input);
    await removerPendenteParaTeste(a.localId);

    const restantes = await listarPendentesDaOs("os-1");
    expect(restantes).toHaveLength(1);
    expect(restantes[0].localId).not.toBe(a.localId);
  });

  it("falha marca o item em vez de descartar", async () => {
    // Descartar perderia a foto em silencio, que e o exato problema que a fila
    // existe pra evitar.
    const a = await enfileirarEvidencia("os-1", input);
    await marcarFalhouParaTeste(a.localId);

    const [pendente] = await listarPendentesDaOs("os-1");
    expect(pendente.localId).toBe(a.localId);
    expect(pendente.falhou).toBe(true);
  });

  it("sobrevive a storage corrompido, devolvendo fila vazia", async () => {
    memoria.set("isphub_evidencias_outbox", "{ isso nao e json");
    expect(await listarPendentesDaOs("os-1")).toEqual([]);
  });
});
