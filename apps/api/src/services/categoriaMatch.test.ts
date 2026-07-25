import { describe, expect, it } from "vitest";
import { normalizarTexto, sugerirCategoriaId, type CategoriaParaMatch } from "./categoriaMatch.js";

describe("normalizarTexto", () => {
  it("remove acentos e coloca em minusculas", () => {
    expect(normalizarTexto("Instalação")).toBe("instalacao");
    expect(normalizarTexto("Mudança de Endereço")).toBe("mudanca de endereco");
  });

  it("remove emoji/simbolos mantendo as palavras", () => {
    expect(normalizarTexto("🚨 Retirada 🚨")).toBe("retirada");
  });

  it("colapsa espacos multiplos e remove das bordas", () => {
    expect(normalizarTexto("  Sem   Conexao  ")).toBe("sem conexao");
  });

  it("string vazia continua vazia", () => {
    expect(normalizarTexto("")).toBe("");
    expect(normalizarTexto("🚨🚨")).toBe("");
  });
});

describe("sugerirCategoriaId", () => {
  const categorias: CategoriaParaMatch[] = [
    { id: "instalacao", ordem: 1, ativo: true, palavrasChave: ["instal", "novo cliente", "ativacao"] },
    { id: "reparo", ordem: 2, ativo: true, palavrasChave: ["sem conex", "reparo", "corretiva"] },
    { id: "mudanca", ordem: 4, ativo: true, palavrasChave: ["mudanca", "troca de endereco"] },
    { id: "troca-equip", ordem: 5, ativo: true, palavrasChave: ["troca", "equipamento"] },
    { id: "inativa", ordem: 0, ativo: false, palavrasChave: ["instal"] },
  ];

  it("casa por palavra-chave simples", () => {
    expect(sugerirCategoriaId("Instalação Nova", categorias)).toBe("instalacao");
    expect(sugerirCategoriaId("Sem conexão no bairro", categorias)).toBe("reparo");
  });

  it("ignora acento/emoji/caixa ao comparar", () => {
    expect(sugerirCategoriaId("🚨 SEM CONEXÃO 🚨", categorias)).toBe("reparo");
  });

  it("nomes diferentes por provedor caem na mesma categoria", () => {
    // "Novo cliente" e "Ativação" sao sinonimos de instalacao em SGPs distintos.
    expect(sugerirCategoriaId("Novo Cliente - Fibra", categorias)).toBe("instalacao");
    expect(sugerirCategoriaId("Ativação de plano", categorias)).toBe("instalacao");
  });

  it("respeita a ordem quando mais de uma categoria poderia casar", () => {
    // "troca de endereco" bate tanto em "mudanca" (ordem 4, frase completa)
    // quanto em "troca-equip" (ordem 5, so "troca") — a de menor ordem vence.
    expect(sugerirCategoriaId("Troca de Endereço", categorias)).toBe("mudanca");
    // Sem a frase completa, "Troca de roteador" so bate em troca-equip.
    expect(sugerirCategoriaId("Troca de roteador", categorias)).toBe("troca-equip");
  });

  it("ignora categorias inativas", () => {
    // "inativa" tambem tem "instal" mas esta ativo=false — nao deve ganhar
    // mesmo tendo ordem menor (0) que "instalacao" (1).
    expect(sugerirCategoriaId("Instalação padrão", categorias)).toBe("instalacao");
  });

  it("retorna null quando nada casa", () => {
    expect(sugerirCategoriaId("Motivo totalmente desconhecido", categorias)).toBeNull();
  });

  it("retorna null para descricao vazia", () => {
    expect(sugerirCategoriaId("", categorias)).toBeNull();
    expect(sugerirCategoriaId("🚨🚨", categorias)).toBeNull();
  });
});
