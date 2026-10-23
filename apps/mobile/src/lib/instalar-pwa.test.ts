import { describe, expect, it } from "vitest";
import { modoInstalacao } from "./instalar-pwa";

const ANDROID = "Mozilla/5.0 (Linux; Android 13; moto g22) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

describe("modoInstalacao", () => {
  it("Chrome com pedido de instalação: botão", () => {
    expect(modoInstalacao({ instalado: false, temPedido: true, userAgent: ANDROID, toques: 5 })).toBe("botao");
  });

  it("já aberto como app instalado: nada, mesmo com pedido", () => {
    expect(modoInstalacao({ instalado: true, temPedido: true, userAgent: ANDROID, toques: 5 })).toBeNull();
    expect(modoInstalacao({ instalado: true, temPedido: false, userAgent: IPHONE, toques: 5 })).toBeNull();
  });

  it("iPhone e iPad (que se diz Mac, mas tem toque): dica do Compartilhar", () => {
    expect(modoInstalacao({ instalado: false, temPedido: false, userAgent: IPHONE, toques: 5 })).toBe("dica-ios");
    expect(modoInstalacao({ instalado: false, temPedido: false, userAgent: IPAD, toques: 5 })).toBe("dica-ios");
  });

  it("Mac de verdade ou Android ainda sem pedido: nada", () => {
    expect(modoInstalacao({ instalado: false, temPedido: false, userAgent: IPAD, toques: 0 })).toBeNull();
    expect(modoInstalacao({ instalado: false, temPedido: false, userAgent: ANDROID, toques: 5 })).toBeNull();
  });
});
