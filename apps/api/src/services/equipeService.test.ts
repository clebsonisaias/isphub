import { describe, expect, it } from "vitest";
import { OS_EXTERNA_WHERE, OS_INTERNA_WHERE, whereEquipeOs } from "./equipeService.js";

describe("whereEquipeOs", () => {
  it("interna cobre os 3 casos: sem tipo, tipo sem categoria, categoria interna", () => {
    const w = whereEquipeOs("interna");
    expect(w).toEqual({
      OR: [
        { tipoOsId: null },
        { tipoOs: { categoriaId: null } },
        { tipoOs: { categoria: { equipeExterna: false } } },
      ],
    });
  });

  it("interna NUNCA usa NOT sobre a relacao opcional (regressao: NULL IN (...) descarta a linha)", () => {
    // Guarda explicita contra alguem "simplificar" pra NOT no futuro — NOT
    // sobre uma relacao nullable some com OS sem tipo/categoria em silencio.
    expect(JSON.stringify(whereEquipeOs("interna"))).not.toContain("NOT");
  });

  it("externa e um filtro positivo pela flag da categoria", () => {
    expect(whereEquipeOs("externa")).toEqual({ tipoOs: { categoria: { equipeExterna: true } } });
  });

  it("todas nao aplica nenhuma clausula (escape hatch de auditoria)", () => {
    expect(whereEquipeOs("todas")).toBeNull();
  });

  it("as constantes exportadas batem com o que whereEquipeOs devolve", () => {
    expect(whereEquipeOs("interna")).toBe(OS_INTERNA_WHERE);
    expect(whereEquipeOs("externa")).toBe(OS_EXTERNA_WHERE);
  });
});
