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

  it("monta mensagem limpa com previsão de chegada (tempo estimado e distância TomTom)", () => {
    const texto = formatarMensagemTecnicoACaminho({
      clienteNome: "Clebson Isaias",
      tecnicoNome: "Lucas Silva",
      provedorNome: "NetGo Fibra",
      numeroOs: "213680",
      veiculoInfo: { rotulo: "Strada 02", placa: "RGF8H99" },
      tempoEstimado: {
        faixaMinutos: "15 a 20 minutos",
        distanciaTexto: "3,8 km",
      },
      fotoUrl: null,
    });

    expect(texto).toContain("Clebson");
    expect(texto).toContain("Lucas");
    expect(texto).toContain("NetGo Fibra");
    expect(texto).toContain("213680");
    expect(texto).toContain("⏱️ *Previsão de chegada:* cerca de 15 a 20 minutos (~3,8 km de distância).");
    expect(texto).toContain("Strada 02 (Placa RGF8H99)");
    expect(texto).not.toContain("Identificação de segurança");
    expect(texto).not.toContain("http");
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
