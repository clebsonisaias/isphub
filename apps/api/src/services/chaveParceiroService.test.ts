import { describe, expect, it, vi, beforeEach } from "vitest";

const update = vi.fn();
const updateMany = vi.fn();
const findUnique = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  prisma: { atendaiConfig: { update, updateMany, findUnique } },
}));

const { gerarChaveEntrada, provedorDaChave, revogarChaveEntrada } = await import("./chaveParceiroService.js");

/** O mesmo hash do servico — se ele mudar, estes testes tem que quebrar. */
const { createHash } = await import("node:crypto");
const hash = (c: string) => createHash("sha256").update(c, "utf8").digest("hex");

beforeEach(() => {
  update.mockReset().mockResolvedValue({});
  updateMany.mockReset().mockResolvedValue({});
  findUnique.mockReset();
});

describe("gerarChaveEntrada", () => {
  it("devolve a chave em claro e guarda so o HASH", async () => {
    const chave = await gerarChaveEntrada("prov-1");
    expect(chave).toMatch(/^isk_[\w-]{20,}$/);

    const gravado = update.mock.calls[0][0].data;
    // O que vai pro banco NAO pode conter a chave — se contivesse, um dump de
    // banco viraria uma lista de credenciais validas.
    expect(JSON.stringify(gravado)).not.toContain(chave.slice(12));
    expect(gravado.chaveEntradaHash).toBe(hash(chave));
    expect(gravado.chaveEntradaPrefixo).toBe(chave.slice(0, 12));
    // Regerar zera o "ultimo uso": o numero passa a ser da chave nova.
    expect(gravado.chaveEntradaUsoEm).toBeNull();
  });

  it("duas chamadas nunca produzem a mesma chave", async () => {
    expect(await gerarChaveEntrada("p")).not.toBe(await gerarChaveEntrada("p"));
  });
});

describe("provedorDaChave", () => {
  const linha = (over: Record<string, unknown> = {}) => ({
    id: "cfg-1",
    provedorId: "prov-1",
    ativo: true,
    chaveEntradaHash: hash("isk_certa"),
    ...over,
  });

  it("chave certa resolve o provedor", async () => {
    findUnique.mockResolvedValue(linha());
    expect(await provedorDaChave("isk_certa")).toBe("prov-1");
  });

  it("chave com o prefixo certo mas corpo errado NAO resolve", async () => {
    // O prefixo e publico (vai em claro no banco). Se ele bastasse, saber o
    // prefixo — que a propria tela mostra — seria saber a chave.
    findUnique.mockResolvedValue(linha());
    expect(await provedorDaChave("isk_errada")).toBeNull();
  });

  it("sem o prefixo isk_ nem consulta o banco", async () => {
    expect(await provedorDaChave("ak_de_outro_sistema")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("integracao desativada recusa, mesmo com a chave certa", async () => {
    findUnique.mockResolvedValue(linha({ ativo: false }));
    expect(await provedorDaChave("isk_certa")).toBeNull();
  });

  it("chave revogada (hash nulo) recusa", async () => {
    findUnique.mockResolvedValue(linha({ chaveEntradaHash: null }));
    expect(await provedorDaChave("isk_certa")).toBeNull();
  });

  it("provedor sem linha nenhuma recusa", async () => {
    findUnique.mockResolvedValue(null);
    expect(await provedorDaChave("isk_certa")).toBeNull();
  });
});

describe("revogarChaveEntrada", () => {
  it("limpa hash, prefixo e uso — e nao toca no resto do cadastro", async () => {
    await revogarChaveEntrada("prov-1");
    const data = updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ chaveEntradaHash: null, chaveEntradaPrefixo: null, chaveEntradaUsoEm: null });
  });
});
