import { describe, expect, it, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const deleteMany = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  prisma: { chaveParceiro: { upsert, deleteMany, findUnique, update } },
}));

const { gerarChaveEntrada, provedorDaChave, revogarChaveEntrada } = await import("./chaveParceiroService.js");

/** O mesmo hash do servico — se ele mudar, estes testes tem que quebrar. */
const { createHash } = await import("node:crypto");
const hash = (c: string) => createHash("sha256").update(c, "utf8").digest("hex");

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({});
  deleteMany.mockReset().mockResolvedValue({});
  update.mockReset().mockResolvedValue({});
  findUnique.mockReset();
});

describe("gerarChaveEntrada", () => {
  it("devolve a chave em claro e guarda so o HASH", async () => {
    const chave = await gerarChaveEntrada("prov-1");
    expect(chave).toMatch(/^isk_[\w-]{20,}$/);

    const { create, update: upd } = upsert.mock.calls[0][0];
    // O que vai pro banco NAO pode conter a chave — se contivesse, um dump de
    // banco viraria uma lista de credenciais validas.
    expect(JSON.stringify(create)).not.toContain(chave.slice(12));
    expect(create.hash).toBe(hash(chave));
    expect(create.prefixo).toBe(chave.slice(0, 12));
    // Regerar zera o "ultimo uso": o numero passa a ser da chave nova.
    expect(upd.usoEm).toBeNull();
  });

  it("nao exige nada alem do provedor — qualquer sistema pode ganhar chave", async () => {
    await gerarChaveEntrada("prov-sem-atendai", "ERP X");
    expect(upsert.mock.calls[0][0].where).toEqual({ provedorId: "prov-sem-atendai" });
    expect(upsert.mock.calls[0][0].create.rotulo).toBe("ERP X");
  });

  it("duas chamadas nunca produzem a mesma chave", async () => {
    expect(await gerarChaveEntrada("p")).not.toBe(await gerarChaveEntrada("p"));
  });
});

describe("provedorDaChave", () => {
  const linha = (over: Record<string, unknown> = {}) => ({
    id: "chave-1",
    provedorId: "prov-1",
    hash: hash("isk_certa"),
    provedor: { ativo: true },
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

  it("provedor desativado recusa, mesmo com a chave certa", async () => {
    findUnique.mockResolvedValue(linha({ provedor: { ativo: false } }));
    expect(await provedorDaChave("isk_certa")).toBeNull();
  });

  it("chave inexistente recusa", async () => {
    findUnique.mockResolvedValue(null);
    expect(await provedorDaChave("isk_certa")).toBeNull();
  });
});

describe("revogarChaveEntrada", () => {
  it("apaga a chave do provedor — e so dele", async () => {
    await revogarChaveEntrada("prov-1");
    expect(deleteMany.mock.calls[0][0]).toEqual({ where: { provedorId: "prov-1" } });
  });
});
