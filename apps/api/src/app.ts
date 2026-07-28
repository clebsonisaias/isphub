import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { provedoresRouter } from "./routes/provedores.js";
import { categoriasRouter } from "./routes/categorias.js";
import { usuariosRouter } from "./routes/usuarios.js";
import { erpConfigRouter } from "./routes/erpConfig.js";
import { tiposOsRouter } from "./routes/tiposOs.js";
import { syncRouter } from "./routes/sync.js";
import { filaRouter } from "./routes/fila.js";
import { ordensServicoRouter } from "./routes/ordensServico.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { tecnicosRouter } from "./routes/tecnicos.js";
import { conexaoRouter } from "./routes/conexao.js";
import { fttxRouter } from "./routes/fttx.js";
import { notificacoesRouter } from "./routes/notificacoes.js";
import { horaRouter } from "./routes/hora.js";
import { configRouter, adminModulosRouter } from "./routes/config.js";
import { eventosRouter } from "./routes/eventos.js";
import { syncMinhasRouter } from "./routes/syncMinhas.js";
import { chatRouter } from "./routes/chat.js";

export function createApp() {
  const app = express();

  // A API roda atras do proxy do Coolify (Traefik). Sem isto, `req.ip` e o IP
  // do proxy — IGUAL pra todo mundo — e todo rate limit vira um balde unico
  // global: 10 logins errados de um desconhecido travavam o login de TODA a
  // operacao por 15 min (e o brute-force real ficava sem barreira nenhuma).
  // `1` = confia num unico proxy a frente; nao usar `true` (confia em qualquer
  // X-Forwarded-For, o cliente forja o proprio IP e escapa do limite).
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  // Compressao antes das rotas: a fila devolve ate 2000 itens de JSON muito
  // repetitivo — gzip corta a maior parte do trafego do app em campo (3G/4G).
  app.use(compression());
  // Limite global apertado. O corpo grande so e legitimo em anexos (foto/audio
  // em base64), que tem rota propria — nao ha motivo pra /auth/login aceitar 5MB.
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "isphub-api" });
  });

  app.use("/auth", authRouter);
  app.use("/provedores", provedoresRouter);
  app.use("/categorias", categoriasRouter);
  app.use("/usuarios", usuariosRouter);
  app.use("/tecnicos", tecnicosRouter);
  app.use("/notificacoes", notificacoesRouter);
  app.use("/hora", horaRouter);
  app.use("/config", configRouter);
  app.use("/admin/modulos", adminModulosRouter);
  app.use("/eventos", eventosRouter);
  app.use("/sync", syncMinhasRouter);
  app.use("/chat", chatRouter);
  app.use("/provedores/:provedorId/erp-config", erpConfigRouter);
  app.use("/provedores/:provedorId/tipos-os", tiposOsRouter);
  app.use("/provedores/:provedorId/sync", syncRouter);
  app.use("/provedores/:provedorId/conexao", conexaoRouter);
  app.use("/provedores/:provedorId/fttx", fttxRouter);
  app.use("/fila", filaRouter);
  app.use("/ordens-servico", ordensServicoRouter);
  app.use("/dashboard", dashboardRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Rota nao encontrada" });
  });

  app.use(errorHandler);

  return app;
}
