import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O push tem UMA propriedade que nao pode quebrar: e best-effort. Se enviar
 * notificacao pudesse lancar, uma indisponibilidade do Expo derrubaria o envio
 * de mensagem no chat e a atribuicao de OS — o trabalho pararia porque o AVISO
 * do trabalho falhou. Os testes abaixo travam isso.
 */

const { findMany, deleteMany, upsert } = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  upsert: vi.fn(),
}));
const { sendPushNotificationsAsync } = vi.hoisted(() => ({ sendPushNotificationsAsync: vi.fn() }));

vi.mock("../lib/prisma.js", () => ({
  prisma: { pushToken: { findMany, deleteMany, upsert } },
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    static isExpoPushToken(t: unknown) {
      return typeof t === "string" && t.startsWith("ExponentPushToken[");
    }
    chunkPushNotifications(m: unknown[]) {
      return [m];
    }
    sendPushNotificationsAsync = sendPushNotificationsAsync;
  }
  return { Expo };
});

const { enviarPush, registrarToken } = await import("./pushService.js");

const CONTEUDO = { titulo: "t", corpo: "c", dados: { tela: "chat" as const, conversaId: "c1" } };
const TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("enviarPush — best-effort", () => {
  it("banco fora do ar NAO lanca (o chamador segue e a mensagem e enviada)", async () => {
    findMany.mockRejectedValue(new Error("conexao recusada"));
    await expect(enviarPush(["u1"], CONTEUDO)).resolves.toBeUndefined();
  });

  it("Expo fora do ar NAO lanca", async () => {
    findMany.mockResolvedValue([{ token: TOKEN }]);
    sendPushNotificationsAsync.mockRejectedValue(new Error("503"));
    await expect(enviarPush(["u1"], CONTEUDO)).resolves.toBeUndefined();
  });

  it("sem destinatarios: nem consulta o banco", async () => {
    await enviarPush([], CONTEUDO);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("usuario sem aparelho registrado: nao chama o Expo", async () => {
    findMany.mockResolvedValue([]);
    await enviarPush(["u1"], CONTEUDO);
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it("deduplica destinatarios (participante repetido nao vira dois avisos)", async () => {
    findMany.mockResolvedValue([{ token: TOKEN }]);
    sendPushNotificationsAsync.mockResolvedValue([{ status: "ok" }]);
    await enviarPush(["u1", "u1", "u1"], CONTEUDO);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { usuarioId: { in: ["u1"] } } }));
  });
});

describe("enviarPush — higiene dos tokens", () => {
  it("token que o Expo diz nao registrado e APAGADO (app desinstalado)", async () => {
    findMany.mockResolvedValue([{ token: TOKEN }]);
    sendPushNotificationsAsync.mockResolvedValue([
      { status: "error", message: "morto", details: { error: "DeviceNotRegistered" } },
    ]);
    await enviarPush(["u1"], CONTEUDO);
    expect(deleteMany).toHaveBeenCalledWith({ where: { token: { in: [TOKEN] } } });
  });

  it("outro erro do Expo NAO apaga o token (falha temporaria nao descadastra o aparelho)", async () => {
    findMany.mockResolvedValue([{ token: TOKEN }]);
    sendPushNotificationsAsync.mockResolvedValue([
      { status: "error", message: "limite", details: { error: "MessageRateExceeded" } },
    ]);
    await enviarPush(["u1"], CONTEUDO);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("token com formato invalido e descartado antes de chamar o Expo", async () => {
    findMany.mockResolvedValue([{ token: "lixo" }]);
    await enviarPush(["u1"], CONTEUDO);
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
  });
});

describe("registrarToken", () => {
  it("upsert e pelo TOKEN: o aparelho troca de dono quando outro tecnico loga nele", async () => {
    await registrarToken("u2", TOKEN, "android");
    expect(upsert).toHaveBeenCalledWith({
      where: { token: TOKEN },
      create: { token: TOKEN, usuarioId: "u2", plataforma: "android" },
      update: { usuarioId: "u2", plataforma: "android" },
    });
  });

  it("token invalido: lanca (aqui SIM, e erro do cliente, vira 400 na rota)", async () => {
    await expect(registrarToken("u1", "nao-e-token", "android")).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
