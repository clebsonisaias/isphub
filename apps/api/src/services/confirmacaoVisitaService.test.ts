import { describe, expect, it } from "vitest";
import {
  interpretarRespostaCliente,
  matchTelefone,
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

  describe("matchTelefone", () => {
    it("faz match exato de telefone formatado com E.164 e DDD", () => {
      expect(matchTelefone("(84) 99876-5432", "5584998765432")).toBe(true);
      expect(matchTelefone("84998765432", "5584998765432")).toBe(true);
      expect(matchTelefone("5584998765432", "5584998765432")).toBe(true);
    });

    it("faz match quando telefone cadastrado tem 8 dígitos (celular legado sem 9)", () => {
      // 84 9876-5432 deve casar com 5584998765432 (que ganha o 9 pelo normalizarTelefoneBR)
      expect(matchTelefone("(84) 9876-5432", "5584998765432")).toBe(true);
    });

    it("rejeita telefones com DDDs diferentes mesmo que tenham os mesmos 8 ou 9 dígitos finais", () => {
      // (83) Paraíba NÃO deve casar com (84) Rio Grande do Norte
      expect(matchTelefone("(83) 99876-5432", "5584998765432")).toBe(false);
      expect(matchTelefone("83998765432", "5584998765432")).toBe(false);
    });

    it("faz fallback seguro caso cadastro contenha apenas os 8 ou 9 dígitos locais sem DDD", () => {
      expect(matchTelefone("998765432", "5584998765432")).toBe(true);
      expect(matchTelefone("98765432", "5584998765432")).toBe(true);
      // Número totalmente diferente
      expect(matchTelefone("991112222", "5584998765432")).toBe(false);
    });

    it("retorna false para valores nulos ou vazios", () => {
      expect(matchTelefone(null, "5584998765432")).toBe(false);
      expect(matchTelefone(undefined, "5584998765432")).toBe(false);
      expect(matchTelefone("", "5584998765432")).toBe(false);
    });
  });
});
