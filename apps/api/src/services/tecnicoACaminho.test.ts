import { describe, expect, it } from "vitest";
import { formatarMensagemTecnicoACaminho } from "./clienteAtendaiService.js";

describe("tecnicoACaminho", () => {
  it("monta mensagem com dados completos (tecnico, veiculo e foto)", () => {
    const texto = formatarMensagemTecnicoACaminho({
      clienteNome: "João da Silva",
      tecnicoNome: "Carlos Eduardo",
      provedorNome: "NetGo",
      numeroOs: "213678",
      veiculoInfo: { rotulo: "Fiorino 04", placa: "RGF1A23" },
      fotoUrl: "https://api.isphub.net.br/auth/foto/tec-123?v=1",
    });

    expect(texto).toContain("João");
    expect(texto).toContain("Carlos");
    expect(texto).toContain("NetGo");
    expect(texto).toContain("213678");
    expect(texto).toContain("Fiorino 04 (Placa RGF1A23)");
    expect(texto).toContain("https://api.isphub.net.br/auth/foto/tec-123?v=1");
    expect(texto).toContain("Identificação de segurança");
  });

  it("monta mensagem sem veiculo e sem foto graciosa quando nao disponiveis", () => {
    const texto = formatarMensagemTecnicoACaminho({
      clienteNome: "Maria Oliveira",
      tecnicoNome: "Lucas",
      provedorNome: "NetGo",
      numeroOs: "213679",
      veiculoInfo: null,
      fotoUrl: null,
    });

    expect(texto).toContain("Maria");
    expect(texto).toContain("Lucas");
    expect(texto).toContain("NetGo");
    expect(texto).toContain("213679");
    expect(texto).not.toContain("Veículo oficial");
    expect(texto).not.toContain("Identificação de segurança");
    expect(texto).toContain("fique atento ao portão/interfone");
  });
});
