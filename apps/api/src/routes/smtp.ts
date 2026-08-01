import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as smtpConfigService from "../services/smtpConfigService.js";

export const smtpRouter = Router();

/**
 * ADMIN only. A senha do SMTP manda e-mail EM NOME do ISPhub: com ela da pra
 * disparar mensagem que parece oficial pra qualquer endereco — bem mais
 * sensivel que credencial de um provedor so.
 */
smtpRouter.use(requireAuth, requireRole(UserRole.ADMIN));

const configSchema = z.object({
  host: z.string().trim().min(1, "Informe o servidor"),
  porta: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().optional(),
  usuario: z.string().trim().max(200).nullish(),
  // `min(1)` junto de nullish: string vazia da tela vira "nao mexer na senha",
  // nao "apagar a senha".
  senha: z.string().min(1).max(300).nullish(),
  remetente: z.string().trim().max(200).nullish(),
  ativo: z.boolean().optional(),
});

smtpRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await smtpConfigService.obterConfigPublic());
  }),
);

smtpRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const dados = configSchema.parse(req.body);
    res.json(await smtpConfigService.salvarConfig(dados));
  }),
);

const testeSchema = z.object({ destinatario: z.string().email() });

/**
 * Envia um e-mail de teste de verdade.
 *
 * Devolve 200 com `ok: false` quando o SMTP recusa — nao e erro da API, e o
 * resultado do teste, e a mensagem do servidor de e-mail e justamente o que
 * aponta a causa (auth, DNS, porta, TLS).
 */
smtpRouter.post(
  "/testar",
  asyncHandler(async (req, res) => {
    const { destinatario } = testeSchema.parse(req.body);
    res.json(await smtpConfigService.enviarTeste(destinatario));
  }),
);

smtpRouter.patch(
  "/ativo",
  asyncHandler(async (req, res) => {
    const { ativo } = z.object({ ativo: z.boolean() }).parse(req.body);
    res.json(await smtpConfigService.definirAtivo(ativo));
  }),
);
