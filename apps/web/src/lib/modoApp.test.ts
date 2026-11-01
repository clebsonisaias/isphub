import { describe, expect, it, vi } from "vitest";
import { abreFora, avisarApp, emApp } from "./modoApp";

const PAINEL = "https://painel.isphub.net.br";

describe("emApp", () => {
  it("só com a marca que o app injeta", () => {
    expect(emApp({ ISPHUB_APP: true })).toBe(true);
    expect(emApp({})).toBe(false);
    expect(emApp(undefined)).toBe(false);
  });
});

describe("avisarApp", () => {
  it("manda JSON pela ponte do WebView, e só no app", () => {
    const postMessage = vi.fn();
    avisarApp({ tipo: "saiu" }, { ISPHUB_APP: true, ReactNativeWebView: { postMessage } });
    expect(postMessage).toHaveBeenCalledWith('{"tipo":"saiu"}');
    postMessage.mockClear();
    avisarApp({ tipo: "saiu" }, { ReactNativeWebView: { postMessage } });
    expect(postMessage).not.toHaveBeenCalled();
  });
  it("app antigo sem ponte não quebra", () => {
    expect(() => avisarApp({ tipo: "saiu" }, { ISPHUB_APP: true })).not.toThrow();
  });
});

describe("abreFora", () => {
  it("o próprio painel fica dentro", () => {
    expect(abreFora("/os/123", PAINEL)).toBe(false);
    expect(abreFora("https://painel.isphub.net.br/chat", PAINEL)).toBe(false);
  });
  it("outro site e outros esquemas saem", () => {
    expect(abreFora("https://www.google.com/maps/dir/?api=1", PAINEL)).toBe(true);
    expect(abreFora("https://api.isphub.net.br/anexo/1", PAINEL)).toBe(true);
    expect(abreFora("tel:84999991234", PAINEL)).toBe(true);
  });
  it("blob e data ficam (o arquivo só existe na página)", () => {
    expect(abreFora("blob:https://painel.isphub.net.br/abc", PAINEL)).toBe(false);
    expect(abreFora("data:application/pdf;base64,AAA", PAINEL)).toBe(false);
  });
});
