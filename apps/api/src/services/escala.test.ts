import { describe, expect, it } from "vitest";
import type { EscalaDoDia } from "@isphub/shared";
import { diaDe, viaturaEfetiva } from "./escalaService.js";

const escalado = (veiculoId: string | null, papel: EscalaDoDia["papel"] = "motorista"): EscalaDoDia => ({
  escalado: true,
  veiculoId,
  veiculoPlaca: veiculoId ? "SUP0001" : null,
  papel,
  parceiros: [],
});
const semEscala: EscalaDoDia = {
  escalado: false,
  veiculoId: null,
  veiculoPlaca: null,
  papel: "motorista",
  parceiros: [],
};

describe("viaturaEfetiva", () => {
  it("com escala, IGNORA o que o app mandou", () => {
    /*
     * O caso que isto protege e o APK ANTIGO, que continua mandando a escolha
     * do tecnico no corpo. Se ela vencesse, a inversao seria so aparente: quem
     * decide voltaria a ser quem esta com pressa de sair.
     */
    const r = viaturaEfetiva(escalado("carro-do-supervisor", "passageiro"), {
      veiculoId: "carro-que-o-tecnico-escolheu",
      papel: "motorista" as const,
    });
    expect(r.veiculoId).toBe("carro-do-supervisor");
    expect(r.papel).toBe("passageiro");
  });

  it("escalado A PE anula a viatura que o app mandou", () => {
    // `veiculoId: null` com escala e decisao explicita do supervisor, nao
    // ausencia de decisao — entao tem que vencer igual.
    const r = viaturaEfetiva(escalado(null), { veiculoId: "carro-qualquer" });
    expect(r.veiculoId).toBeNull();
  });

  it("SEM escala, o que o tecnico declarou continua valendo", () => {
    // No dia em que isto entra nao existe escala nenhuma. Travar a saida de
    // todo mundo ate alguem escalar seria trocar um problema por um pior.
    const r = viaturaEfetiva(semEscala, { veiculoId: "escolha-do-tecnico", papel: "motorista" as const });
    expect(r.veiculoId).toBe("escolha-do-tecnico");
  });

  it("o odometro vem SEMPRE do app, mesmo com escala", () => {
    // Quem le o hodometro e quem esta na frente do painel do carro.
    expect(viaturaEfetiva(escalado("v1"), { odometro: 154_233 }).odometro).toBe(154_233);
  });
});

describe("diaDe", () => {
  it("zera a hora, pra escala ser do DIA e nao de um instante", () => {
    const d = diaDe(new Date("2026-09-01T23:40:00.000Z"));
    expect(d.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
