import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { registrarConexao } from "../services/realtimeHub.js";

/**
 * `GET /eventos` — canal SSE escopado por tecnico. Mantem a conexao aberta e
 * empurra eventos (os-alterada/os-atribuida/os-removida/config-alterada) quando
 * algo do usuario muda. Keep-alive a cada 25s (proxies/Coolify cortam conexao
 * ociosa). Ver realtimeHub + plano (d).
 */
export const eventosRouter = Router();

eventosRouter.use(requireAuth);

eventosRouter.get("/", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // desliga o buffering de proxies (nginx/traefik) pra o evento sair na hora
    "X-Accel-Buffering": "no",
  });
  res.write(":\n\n"); // comentario inicial: abre o stream
  res.flushHeaders?.();

  const remover = registrarConexao(req.user!.sub, res);
  const ping = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      // ignora — o close abaixo limpa
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(ping);
    remover();
    res.end();
  });
});
