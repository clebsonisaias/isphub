import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O ponto destes testes e um so: **e-mail nunca derruba a requisicao**.
 *
 * A API sobe em dev, CI e e2e sem servidor de e-mail nenhum, e a rota de
 * recuperacao precisa responder identico com SMTP no ar ou fora — senao o erro
 * (ou a demora) denuncia quem tem conta no sistema.
 */

const { sendMail, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
const { env } = vi.hoisted(() => ({
  env: { SMTP_HOST: undefined as string | undefined, SMTP_PORT: undefined as number | undefined, SMTP_USER: undefined as string | undefined, SMTP_PASS: undefined as string | undefined, SMTP_FROM: undefined as string | undefined },
}));

vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("../config/env.js", () => ({ env }));

const { enviarEmail, resetarTransporterParaTeste, smtpConfigurado } = await import("./emailService.js");

const EMAIL = { para: "a@b.com", assunto: "Teste", texto: "corpo", html: "<p>corpo</p>" };

beforeEach(() => {
  vi.clearAllMocks();
  resetarTransporterParaTeste();
  env.SMTP_HOST = undefined;
  env.SMTP_PORT = undefined;
  env.SMTP_USER = undefined;
  env.SMTP_PASS = undefined;
  env.SMTP_FROM = undefined;
  createTransport.mockReturnValue({ sendMail });
  sendMail.mockResolvedValue({});
});

describe("sem SMTP configurado", () => {
  it("nao lanca e devolve false", async () => {
    expect(smtpConfigurado()).toBe(false);
    await expect(enviarEmail(EMAIL)).resolves.toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("nao despeja o corpo do e-mail no log", async () => {
    // O corpo carrega o link de redefinicao, que vale por uma troca de senha.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await enviarEmail({ ...EMAIL, texto: "LINK-SECRETO", html: "LINK-SECRETO" });

    const logado = warn.mock.calls.flat().join(" ");
    expect(logado).not.toContain("LINK-SECRETO");
    warn.mockRestore();
  });
});

describe("com SMTP configurado", () => {
  beforeEach(() => {
    env.SMTP_HOST = "smtp.provedor.com";
    env.SMTP_USER = "nao-responda@provedor.com";
    env.SMTP_PASS = "x";
  });

  it("envia e devolve true", async () => {
    await expect(enviarEmail(EMAIL)).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: EMAIL.para, subject: EMAIL.assunto }),
    );
  });

  it("porta 465 usa TLS implicito; 587 sobe por STARTTLS", async () => {
    // Errar isso e a causa mais comum de "conecta e trava" em SMTP.
    env.SMTP_PORT = 465;
    await enviarEmail(EMAIL);
    expect(createTransport.mock.calls[0][0].secure).toBe(true);

    resetarTransporterParaTeste();
    env.SMTP_PORT = 587;
    await enviarEmail(EMAIL);
    expect(createTransport.mock.calls[1][0].secure).toBe(false);
  });

  it("sem porta declarada assume 587 (o padrao de submissao)", async () => {
    await enviarEmail(EMAIL);
    expect(createTransport.mock.calls[0][0].port).toBe(587);
  });

  it("remetente cai pro SMTP_USER quando SMTP_FROM nao existe", async () => {
    await enviarEmail(EMAIL);
    expect(sendMail.mock.calls[0][0].from).toBe("nao-responda@provedor.com");
  });

  it("falha de envio devolve false em vez de propagar — a rota nao pode virar 500", async () => {
    sendMail.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(enviarEmail(EMAIL)).resolves.toBe(false);

    error.mockRestore();
  });

  it("reaproveita o transporter entre envios (nao abre conexao por e-mail)", async () => {
    await enviarEmail(EMAIL);
    await enviarEmail(EMAIL);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});
