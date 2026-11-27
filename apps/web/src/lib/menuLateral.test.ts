import { describe, expect, it } from "vitest";
import { GRUPOS_MENU, agruparMenu, rotaAtiva } from "./menuLateral";

const item = (to: string) => ({ to });

describe("agruparMenu", () => {
  it("arruma nos grupos do desenho, na ordem do desenho, qualquer que seja a ordem de entrada", () => {
    const g = agruparMenu(["/chat", "/mapa", "/agenda", "/", "/despacho", "/marcar-visita"].map(item));
    expect(g.map((x) => x.titulo)).toEqual(["Operação", "Agenda", "Conversas"]);
    expect(g[0]!.itens.map((i) => i.to)).toEqual(["/", "/despacho", "/mapa"]);
    expect(g[1]!.itens.map((i) => i.to)).toEqual(["/marcar-visita", "/agenda"]);
  });

  it("grupo sem nenhum item visivel some (tecnico nao ve o titulo 'Frota' vazio)", () => {
    const g = agruparMenu(["/", "/mapa", "/chat"].map(item));
    expect(g.map((x) => x.titulo)).not.toContain("Frota");
    expect(g.map((x) => x.titulo)).not.toContain("Gestão");
  });

  it("rota que ninguem agrupou nao some: cai no fim de Gestão", () => {
    const g = agruparMenu(["/rota-nova", "/dashboard"].map(item));
    expect(g).toHaveLength(1);
    expect(g[0]!.titulo).toBe("Gestão");
    expect(g[0]!.itens.map((i) => i.to)).toEqual(["/dashboard", "/rota-nova"]);
  });

  it("nao cria nem perde item: entra N, sai N", () => {
    const todas = GRUPOS_MENU.flatMap((x) => x.rotas);
    const g = agruparMenu(todas.map(item));
    expect(g.flatMap((x) => x.itens).map((i) => i.to).sort()).toEqual([...todas].sort());
  });

  it("nenhuma rota esta em dois grupos", () => {
    const todas = GRUPOS_MENU.flatMap((x) => x.rotas);
    expect(new Set(todas).size).toBe(todas.length);
  });
});

describe("rotaAtiva", () => {
  it("Painel so na raiz, nao em toda rota", () => {
    expect(rotaAtiva("/", "/")).toBe(true);
    expect(rotaAtiva("/", "/despacho")).toBe(false);
  });
  it("Administração cobre as subpaginas", () => {
    expect(rotaAtiva("/admin", "/admin/usuarios")).toBe(true);
  });
  it("Frota cobre mapa e veiculo, mas /frota/bi e so de 'Frota em números'", () => {
    expect(rotaAtiva("/frota", "/frota/mapa")).toBe(true);
    expect(rotaAtiva("/frota", "/frota/veiculos/abc")).toBe(true);
    expect(rotaAtiva("/frota", "/frota/bi")).toBe(false);
    expect(rotaAtiva("/frota/bi", "/frota/bi")).toBe(true);
  });
});
