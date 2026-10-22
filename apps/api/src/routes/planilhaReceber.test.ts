import { describe, expect, it } from "vitest";
import { tokenConfere } from "./planilhaReceber.js";

describe("segredo do Apps Script", () => {
  const segredo = "a".repeat(40);

  it("aceita so o segredo exato", () => {
    expect(tokenConfere(segredo, segredo)).toBe(true);
    expect(tokenConfere(segredo.slice(1) + "b", segredo)).toBe(false);
    expect(tokenConfere(segredo + "a", segredo)).toBe(false);
    expect(tokenConfere(undefined, segredo)).toBe(false);
    expect(tokenConfere("", segredo)).toBe(false);
  });

  it("segredo nao configurado ou curto demais trava tudo (nunca aceita vazio com vazio)", () => {
    expect(tokenConfere("", "")).toBe(false);
    expect(tokenConfere(undefined, undefined)).toBe(false);
    expect(tokenConfere("curto", "curto")).toBe(false);
  });
});
