import { describe, expect, it } from "vitest";
import { UserRole } from "@isphub/shared";
import { montarModulosHabilitados, togglePatchInvalido, type ModuloConfigRow } from "./moduloService.js";

const semRegistros: ModuloConfigRow[] = [];

describe("montarModulosHabilitados", () => {
  it("banco vazio: devolve os modulos ligados no lancamento pro tecnico, ordenados", () => {
    const ids = montarModulosHabilitados(semRegistros, UserRole.TECNICO).map((m) => m.id);
    // Nucleo enxuto: minhas-os (core) + conexao + evidencias + rota + notificacoes + chat.
    // assinatura, provisionamento e retiradas nascem desligados (ativoPadrao=false).
    expect(ids).toEqual(["minhas-os", "conexao", "evidencias", "rota", "notificacoes", "chat"]);
  });

  it("core (minhas-os) aparece SEMPRE — nem um registro ativo=false o desliga", () => {
    const registros: ModuloConfigRow[] = [{ moduloId: "minhas-os", ativo: false, ordem: 0, rolesPermitidos: [UserRole.TECNICO] }];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    expect(ids).toContain("minhas-os");
    expect(ids[0]).toBe("minhas-os");
  });

  it("registro pode DESLIGAR um modulo nao-core (evidencias some)", () => {
    const registros: ModuloConfigRow[] = [{ moduloId: "evidencias", ativo: false, ordem: 20, rolesPermitidos: [UserRole.TECNICO] }];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    expect(ids).not.toContain("evidencias");
    expect(ids).toContain("conexao");
  });

  it("registro pode LIGAR um modulo que nasce desligado (assinatura aparece)", () => {
    const registros: ModuloConfigRow[] = [{ moduloId: "assinatura", ativo: true, ordem: 50, rolesPermitidos: [UserRole.TECNICO] }];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    expect(ids).toContain("assinatura");
  });

  it("recorte por role: modulo cujo rolesPermitidos nao inclui o papel some", () => {
    const registros: ModuloConfigRow[] = [{ moduloId: "conexao", ativo: true, ordem: 10, rolesPermitidos: [UserRole.GESTOR] }];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    expect(ids).not.toContain("conexao");
  });

  // --- Regressao: o app abria SEM MENU NENHUM ---
  // O filtro de papel derrubava ate o modulo core, e nenhum modulo do catalogo
  // listava ADMIN — entao `GET /config` devolvia [] pro admin e o layout do app
  // escondia todas as rotas (href:null), resultando numa tela sem abas.

  it("NENHUM papel interno recebe lista vazia — sempre sobra ao menos o core", () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO]) {
      const modulos = montarModulosHabilitados(semRegistros, role);
      expect(modulos.length, `papel ${role} ficou sem modulo`).toBeGreaterThan(0);
      expect(modulos.map((m) => m.id)).toContain("minhas-os");
    }
  });

  it("admin enxerga o app (nao so o core) com o banco vazio", () => {
    const ids = montarModulosHabilitados(semRegistros, UserRole.ADMIN).map((m) => m.id);
    expect(ids[0]).toBe("minhas-os");
    expect(ids).toContain("chat");
  });

  it("gestor nao perde a fila: core aparece mesmo fora do rolesPermitidos gravado", () => {
    const registros: ModuloConfigRow[] = [
      { moduloId: "minhas-os", ativo: true, ordem: 0, rolesPermitidos: [UserRole.TECNICO] },
    ];
    const ids = montarModulosHabilitados(registros, UserRole.GESTOR).map((m) => m.id);
    expect(ids).toContain("minhas-os");
  });

  it("core ignora o filtro de papel, mas nao-core continua respeitando", () => {
    const registros: ModuloConfigRow[] = [
      { moduloId: "minhas-os", ativo: true, ordem: 0, rolesPermitidos: [UserRole.PROVEDOR] },
      { moduloId: "chat", ativo: true, ordem: 45, rolesPermitidos: [UserRole.PROVEDOR] },
    ];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    expect(ids).toContain("minhas-os");
    expect(ids).not.toContain("chat");
  });

  it("ordena pela ordem efetiva (registro sobrepoe a padrao)", () => {
    const registros: ModuloConfigRow[] = [{ moduloId: "notificacoes", ativo: true, ordem: 1, rolesPermitidos: [UserRole.TECNICO] }];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    // notificacoes recebeu ordem 1 -> logo depois do core (ordem 0)
    expect(ids.slice(0, 2)).toEqual(["minhas-os", "notificacoes"]);
  });

  it("ignora registro com moduloId desconhecido (uniao fechada)", () => {
    const registros: ModuloConfigRow[] = [{ moduloId: "modulo-fantasma", ativo: true, ordem: 0, rolesPermitidos: [UserRole.TECNICO] }];
    const ids = montarModulosHabilitados(registros, UserRole.TECNICO).map((m) => m.id);
    expect(ids).not.toContain("modulo-fantasma");
    expect(ids).toContain("minhas-os");
  });
});

describe("togglePatchInvalido (guarda de core)", () => {
  it("desativar um modulo core e invalido", () => {
    expect(togglePatchInvalido("minhas-os", { ativo: false })).toBe(true);
  });

  it("ativar/reordenar um modulo core e valido", () => {
    expect(togglePatchInvalido("minhas-os", { ativo: true })).toBe(false);
    expect(togglePatchInvalido("minhas-os", { ordem: 3 })).toBe(false);
  });

  it("desativar um modulo nao-core e valido", () => {
    expect(togglePatchInvalido("evidencias", { ativo: false })).toBe(false);
  });
});
