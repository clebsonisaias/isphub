import { describe, expect, it } from "vitest";
import {
  interpretarRespostaCliente,
  montarMensagemConfirmacao,
} from "./confirmacaoVisitaService.js";

describe("confirmacaoVisitaService", () => {
  describe("interpretarRespostaCliente", () => {
    it("reconhece respostas afirmativas de confirmacao", () => {
      expect(interpretarRespostaCliente("1")).toBe("confirmar");
      expect(interpretarRespostaCliente("1 - Confirmar")).toBe("confirmar");
      expect(interpretarRespostaCliente("Sim")).toBe("confirmar");
      expect(interpretarRespostaCliente("sim, confirmo")).toBe("confirmar");
      expect(interpretarRespostaCliente("Estarei em casa")).toBe("confirmar");
      expect(interpretarRespostaCliente("Pode vir")).toBe("confirmar");
      expect(interpretarRespostaCliente("Ok")).toBe("confirmar");
      expect(interpretarRespostaCliente("confirmado")).toBe("confirmar");
    });

    it("reconhece solicitacoes de reagendamento", () => {
      expect(interpretarRespostaCliente("2")).toBe("reagendar");
      expect(interpretarRespostaCliente("2 - Reagendar")).toBe("reagendar");
      expect(interpretarRespostaCliente("nao")).toBe("reagendar");
      expect(interpretarRespostaCliente("Não")).toBe("reagendar");
      expect(interpretarRespostaCliente("quero reagendar")).toBe("reagendar");
      expect(interpretarRespostaCliente("remarcar")).toBe("reagendar");
      expect(interpretarRespostaCliente("não estarei")).toBe("reagendar");
      expect(interpretarRespostaCliente("trocar a data")).toBe("reagendar");
    });

    it("retorna 'outro' para mensagens que nao sao de resposta direta", () => {
      expect(interpretarRespostaCliente("qual o valor da fatura?")).toBe("outro");
      expect(interpretarRespostaCliente("bom dia")).toBe("outro");
      expect(interpretarRespostaCliente("quem é?")).toBe("outro");
    });
  });

  describe("montarMensagemConfirmacao", () => {
    it("formata a mensagem com os dados da OS e turno correto", () => {
      const msg = montarMensagemConfirmacao(
        "Carlos Silva",
        "NetGo Fibra",
        "05/11/2026",
        "manha",
        "213678",
      );

      expect(msg).toContain("Carlos");
      expect(msg).toContain("NetGo Fibra");
      expect(msg).toContain("05/11/2026");
      expect(msg).toContain("manhã (08h às 12h)");
      expect(msg).toContain("213678");
      expect(msg).toContain("1 para Confirmar");
      expect(msg).toContain("2 para Reagendar");
    });

    it("formata turno da tarde corretamente", () => {
      const msg = montarMensagemConfirmacao(
        "Maria",
        "NetGo",
        "05/11/2026",
        "tarde",
        "12345",
      );
      expect(msg).toContain("tarde (13h às 18h)");
    });
  });
});
