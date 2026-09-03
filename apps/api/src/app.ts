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
import { atendaiConfigRouter } from "./routes/atendaiConfig.js";
import { tiposOsRouter } from "./routes/tiposOs.js";
import { syncRouter } from "./routes/sync.js";
import { filaRouter } from "./routes/fila.js";
import { ordensServicoRouter } from "./routes/ordensServico.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { financeiroRouter } from "./routes/financeiro.js";
import { tecnicosRouter } from "./routes/tecnicos.js";
import { conexaoRouter } from "./routes/conexao.js";
import { fttxRouter } from "./routes/fttx.js";
import { notificacoesRouter } from "./routes/notificacoes.js";
import { horaRouter } from "./routes/hora.js";
import { configRouter, adminModulosRouter } from "./routes/config.js";
import { eventosRouter } from "./routes/eventos.js";
import { agendaRouter, adminAgendaRouter } from "./routes/agenda.js";
import { parceiroAgendaRouter } from "./routes/parceiroAgenda.js";
import { syncMinhasRouter } from "./routes/syncMinhas.js";
import { chatRouter } from "./routes/chat.js";
import { canaisWhatsappRouter } from "./routes/canaisWhatsapp.js";
import { smtpRouter } from "./routes/smtp.js";
import { diagnosticoRouter } from "./routes/diagnostico.js";
import { jornadaRouter } from "./routes/jornada.js";
import { produtividadeRouter } from "./routes/produtividade.js";
import { frotaRouter } from "./routes/frota.js";
import { linhaMovelRouter } from "./routes/linhaMovel.js";
import { webhooksWhatsappRouter } from "./routes/webhooksWhatsapp.js";
import { clienteChatRouter } from "./routes/clienteChat.js";

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
  // Lista separada por virgula -> array; um valor so continua sendo string.
  // O `cors` aceita os dois, entao producao nao muda de comportamento.
  const origens = env.WEB_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({ origin: origens.length > 1 ? origens : origens[0], credentials: true }));
  // Compressao antes das rotas: a fila devolve ate 2000 itens de JSON muito
  // repetitivo — gzip corta a maior parte do trafego do app em campo (3G/4G).
  app.use(compression());

  // Webhooks WhatsApp: PUBLICA (sem requireAuth) e precisa do corpo CRU pra
  // validar a assinatura HMAC da Meta (X-Hub-Signature-256 e sobre os bytes
  // exatos, nao sobre um JSON re-serializado). Por isso monta o PROPRIO
  // express.json ANTES do global abaixo — so esta rota foge do parser global.
  app.use(
    "/webhooks/whatsapp",
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
    webhooksWhatsappRouter,
  );

  // Evidencia de OS: foto de ate 2MB vira ~2,7MB em base64, entao esta rota
  // precisa de um teto maior que o global. Tem que ser montado AQUI, antes do
  // parser global: o body-parser marca `req._body` e qualquer json() posterior
  // vira no-op. Era exatamente esse o bug — o `express.json({limit:"4mb"})`
  // declarado dentro de routes/ordensServico.ts nunca rodava, e a foto de 2MB
  // que ele existia pra aceitar levava 413. Mesmo motivo do bloco de webhooks
  // acima: quem precisa fugir do parser global tem que vir antes dele.
  app.use("/ordens-servico/:id/evidencias", express.json({ limit: "4mb" }));

  // Comprovante financeiro: PDF/imagem de ate 3MB vira ~4MB em base64. Mesmo
  // motivo e mesma ordem do bloco acima — montado ANTES do parser global,
  // senao o body-parser ja marcou `req._body` e este json() nunca roda.
  app.use("/financeiro/lancamentos/:id/comprovante", express.json({ limit: "5mb" }));

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
  app.use("/agenda", agendaRouter);
  /*
   * Porta de sistemas PARCEIROS (o AtendAI do provedor). Versionada e sob
   * /api/parceiro porque e contrato com outro deploy: as rotas internas podem
   * mudar de forma junto com a tela, esta nao — do outro lado ha um sistema que
   * so atualiza quando alguem decide atualizar.
   */
  app.use("/api/parceiro/v1/agenda", parceiroAgendaRouter);
  app.use("/admin/agenda", adminAgendaRouter);
  app.use("/eventos", eventosRouter);
  app.use("/sync", syncMinhasRouter);
  app.use("/chat", chatRouter);
  app.use("/admin/canais-whatsapp", canaisWhatsappRouter);
  app.use("/admin/smtp", smtpRouter);
  app.use("/admin/diagnostico", diagnosticoRouter);
  app.use("/jornada", jornadaRouter);
  app.use("/produtividade", produtividadeRouter);
  app.use("/chat-clientes", clienteChatRouter);
  app.use("/provedores/:provedorId/erp-config", erpConfigRouter);
  app.use("/provedores/:provedorId/atendai", atendaiConfigRouter);
  app.use("/provedores/:provedorId/tipos-os", tiposOsRouter);
  app.use("/provedores/:provedorId/sync", syncRouter);
  app.use("/provedores/:provedorId/conexao", conexaoRouter);
  app.use("/provedores/:provedorId/fttx", fttxRouter);
  app.use("/fila", filaRouter);
  app.use("/ordens-servico", ordensServicoRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/financeiro", financeiroRouter);
  app.use("/frota", frotaRouter);
  app.use("/linha-movel", linhaMovelRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Rota nao encontrada" });
  });

  app.use(errorHandler);

  return app;
}
