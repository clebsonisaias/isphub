import { describe, expect, it } from "vitest";
import { bloqueadoPorRate, provedoresParaSincronizar, RATE_LIMIT_MS } from "./syncMinhasService.js";

describe("provedoresParaSincronizar", () => {
  it("deduplica provedores (varias OS do mesmo provedor viram um sync)", () => {
    const os = [{ provedorId: "A" }, { provedorId: "B" }, { provedorId: "A" }];
    expect(provedoresParaSincronizar(os).sort()).toEqual(["A", "B"]);
  });

  it("vazio quando o tecnico nao tem OS aberta", () => {
    expect(provedoresParaSincronizar([])).toEqual([]);
  });
});

describe("bloqueadoPorRate", () => {
  it("nao bloqueia na primeira vez (sem registro anterior)", () => {
    expect(bloqueadoPorRate(undefined, 1_000_000)).toBe(false);
  });

  it("bloqueia dentro da janela", () => {
    const agora = 1_000_000;
    expect(bloqueadoPorRate(agora - (RATE_LIMIT_MS - 1), agora)).toBe(true);
  });

  it("libera passada a janela", () => {
    const agora = 1_000_000;
    expect(bloqueadoPorRate(agora - RATE_LIMIT_MS, agora)).toBe(false);
  });
});
