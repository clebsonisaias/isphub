import { describe, expect, it } from "vitest";
import {
  formatarDiaTurnoLongo,
  formatarRotuloSlot,
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
      expect(interpretarRespostaCliente("btn_confirmar_visita")).toBe("confirmar");
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
      expect(interpretarRespostaCliente("btn_reagendar_visita")).toBe("reagendar");
    });

    it("interpreta cliques em botões de slot interativo", () => {
      expect(interpretarRespostaCliente("slot_2026-11-06_manha")).toEqual({
        tipo: "slot",
        dia: "2026-11-06",
        turno: "manha",
      });
      expect(interpretarRespostaCliente("slot_2026-11-07_tarde")).toEqual({
        tipo: "slot",
        dia: "2026-11-07",
        turno: "tarde",
      });
    });

    it("interpreta opções de reagendamento por letras A, B e C", () => {
      expect(interpretarRespostaCliente("A")).toEqual({ tipo: "indice", indice: 0 });
      expect(interpretarRespostaCliente("Opção A")).toEqual({ tipo: "indice", indice: 0 });
      expect(interpretarRespostaCliente("letra a")).toEqual({ tipo: "indice", indice: 0 });
      expect(interpretarRespostaCliente("a)")).toEqual({ tipo: "indice", indice: 0 });

      expect(interpretarRespostaCliente("B")).toEqual({ tipo: "indice", indice: 1 });
      expect(interpretarRespostaCliente("opcao b")).toEqual({ tipo: "indice", indice: 1 });
      expect(interpretarRespostaCliente("b)")).toEqual({ tipo: "indice", indice: 1 });

      expect(interpretarRespostaCliente("C")).toEqual({ tipo: "indice", indice: 2 });
      expect(interpretarRespostaCliente("Opção C")).toEqual({ tipo: "indice", indice: 2 });
      expect(interpretarRespostaCliente("c)")).toEqual({ tipo: "indice", indice: 2 });
    });

    it("interpreta números 1, 2, 3 como índices quando o cliente já solicitou reagendamento", () => {
      // Quando solicitouReagendamento é true, números 1, 2, 3 mapeiam para os 3 slots oferecidos
      expect(interpretarRespostaCliente("1", true)).toEqual({ tipo: "indice", indice: 0 });
      expect(interpretarRespostaCliente("2", true)).toEqual({ tipo: "indice", indice: 1 });
      expect(interpretarRespostaCliente("3", true)).toEqual({ tipo: "indice", indice: 2 });
      expect(interpretarRespostaCliente("opcao 2", true)).toEqual({ tipo: "indice", indice: 1 });
    });

    it("retorna 'outro' para mensagens que nao sao de resposta direta", () => {
      expect(interpretarRespostaCliente("qual o valor da fatura?")).toBe("outro");
      expect(interpretarRespostaCliente("bom dia")).toBe("outro");
      expect(interpretarRespostaCliente("quem é?")).toBe("outro");
    });
  });

  describe("formatarRotuloSlot", () => {
    it("gera rótulo conciso menor ou igual a 20 caracteres para os botões da Meta", () => {
      const rotuloManha = formatarRotuloSlot("2026-11-06", "manha");
      expect(rotuloManha).toBe("Sex 06/11 · Manhã");
      expect(rotuloManha.length).toBeLessThanOrEqual(20);

      const rotuloTarde = formatarRotuloSlot("2026-11-06", "tarde");
      expect(rotuloTarde).toBe("Sex 06/11 · Tarde");
      expect(rotuloTarde.length).toBeLessThanOrEqual(20);

      const rotuloSabado = formatarRotuloSlot("2026-11-07", "manha");
      expect(rotuloSabado).toBe("Sáb 07/11 · Manhã");
      expect(rotuloSabado.length).toBeLessThanOrEqual(20);
    });
  });

  describe("formatarDiaTurnoLongo", () => {
    it("formata a data e o turno de forma detalhada e amigável para o cliente", () => {
      const longoManha = formatarDiaTurnoLongo("2026-11-06", "manha");
      expect(longoManha).toContain("sexta-feira");
      expect(longoManha).toContain("06/11/2026");
      expect(longoManha).toContain("manhã (08h às 12h)");

      const longoTarde = formatarDiaTurnoLongo("2026-11-06", "tarde");
      expect(longoTarde).toContain("sexta-feira");
      expect(longoTarde).toContain("06/11/2026");
      expect(longoTarde).toContain("tarde (13h às 18h)");
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
