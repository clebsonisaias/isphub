import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { provedoresRouter } from "./routes/provedores.js";
import { erpConfigRouter } from "./routes/erpConfig.js";
import { tiposOsRouter } from "./routes/tiposOs.js";
import { syncRouter } from "./routes/sync.js";
import { filaRouter } from "./routes/fila.js";
import { ordensServicoRouter } from "./routes/ordensServico.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { tecnicosRouter } from "./routes/tecnicos.js";
import { conexaoRouter } from "./routes/conexao.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "isphub-api" });
  });

  app.use("/auth", authRouter);
  app.use("/provedores", provedoresRouter);
  app.use("/provedores/:provedorId/erp-config", erpConfigRouter);
  app.use("/provedores/:provedorId/tipos-os", tiposOsRouter);
  app.use("/provedores/:provedorId/sync", syncRouter);
  app.use("/provedores/:provedorId/tecnicos", tecnicosRouter);
  app.use("/provedores/:provedorId/conexao", conexaoRouter);
  app.use("/fila", filaRouter);
  app.use("/ordens-servico", ordensServicoRouter);
  app.use("/dashboard", dashboardRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Rota nao encontrada" });
  });

  app.use(errorHandler);

  return app;
}
