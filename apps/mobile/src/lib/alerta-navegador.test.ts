import { describe, expect, it, vi } from "vitest";
import { alertaNoNavegador, type CaixasDoNavegador } from "./alerta-navegador";

function caixas(resposta: { confirm?: boolean; prompt?: string | null } = {}) {
  return {
    alert: vi.fn(),
    confirm: vi.fn(() => resposta.confirm ?? false),
    prompt: vi.fn(() => resposta.prompt ?? null),
  } satisfies CaixasDoNavegador;
}

describe("alertaNoNavegador", () => {
  it("aviso simples: alert com titulo e mensagem", () => {
    const c = caixas();
    alertaNoNavegador(c, "Não foi possível salvar", "Sem rede");
    expect(c.alert).toHaveBeenCalledWith("Não foi possível salvar\n\nSem rede");
  });

  it("uma acao sem cancelar: avisa e executa a acao (ex.: OK que volta de tela)", () => {
    const c = caixas();
    const ok = vi.fn();
    alertaNoNavegador(c, "ONU autorizada", undefined, [{ text: "OK", onPress: ok }]);
    expect(c.alert).toHaveBeenCalledWith("ONU autorizada");
    expect(ok).toHaveBeenCalled();
  });

  it("acao + cancelar: confirm decide qual roda (ex.: Encerrar jornada?)", () => {
    const encerrar = vi.fn();
    const continuar = vi.fn();
    const botoes = [
      { text: "Continuar trabalhando", style: "cancel" as const, onPress: continuar },
      { text: "Encerrar", style: "destructive" as const, onPress: encerrar },
    ];
    alertaNoNavegador(caixas({ confirm: true }), "Encerrar jornada?", "Em serviço há 8h", botoes);
    expect(encerrar).toHaveBeenCalledTimes(1);
    alertaNoNavegador(caixas({ confirm: false }), "Encerrar jornada?", "Em serviço há 8h", botoes);
    expect(continuar).toHaveBeenCalledTimes(1);
    expect(encerrar).toHaveBeenCalledTimes(1);
  });

  it("duas ou mais acoes: numera e roda a escolhida; resposta invalida ou cancelada = cancelar", () => {
    const camera = vi.fn();
    const galeria = vi.fn();
    const cancelar = vi.fn();
    const botoes = [
      { text: "Câmera", onPress: camera },
      { text: "Galeria", onPress: galeria },
      { text: "Cancelar", style: "cancel" as const, onPress: cancelar },
    ];
    const c = caixas({ prompt: "2" });
    alertaNoNavegador(c, "Foto", "Escolher origem", botoes);
    expect(c.prompt).toHaveBeenCalledWith("Foto\n\nEscolher origem\n\n1. Câmera\n2. Galeria", "1");
    expect(galeria).toHaveBeenCalled();
    alertaNoNavegador(caixas({ prompt: null }), "Foto", undefined, botoes);
    alertaNoNavegador(caixas({ prompt: "9" }), "Foto", undefined, botoes);
    expect(cancelar).toHaveBeenCalledTimes(2);
    expect(camera).not.toHaveBeenCalled();
  });
});
