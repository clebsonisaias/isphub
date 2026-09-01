import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import { OS_EXTERNA_WHERE, OS_INTERNA_WHERE, whereEquipeOs, whereEquipeParaUsuario } from "./equipeService.js";

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

describe("whereEquipeParaUsuario", () => {
  it("TECNICO nao sofre recorte de equipe — OS atribuida a ele nunca some da lista", () => {
    // A regressao que este teste tranca: o app pedia equipe=interna, uma OS de
    // retirada atribuida ao tecnico caia fora do filtro, e ele so alcancava a
    // OS tocando na notificacao. Dispensou a notificacao, perdeu a OS.
    expect(whereEquipeParaUsuario("interna", UserRole.TECNICO)).toBeNull();
    expect(whereEquipeParaUsuario("externa", UserRole.TECNICO)).toBeNull();
    expect(whereEquipeParaUsuario("todas", UserRole.TECNICO)).toBeNull();
  });

  it("os demais papeis continuam recortados — o Painel nao pode misturar retirada na fila da equipe", () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR, UserRole.PROVEDOR]) {
      expect(whereEquipeParaUsuario("interna", role)).toBe(OS_INTERNA_WHERE);
      expect(whereEquipeParaUsuario("externa", role)).toBe(OS_EXTERNA_WHERE);
      expect(whereEquipeParaUsuario("todas", role)).toBeNull();
    }
  });
});
