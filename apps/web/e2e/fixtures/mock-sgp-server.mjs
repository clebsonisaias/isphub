/**
 * SGP fixture para os testes E2E do ISPhub. Simula o suficiente da API do SGP
 * (auth por app+token, catalogo de tipos, tecnicos, listagem de OS
 * e os endpoints de write-back) para exercitar o fluxo completo despacho ->
 * status sem depender de um SGP real. Expõe /_test/log e /_test/reset para
 * os specs confirmarem que o ISPhub de fato conversou com o "SGP".
 *
 * Nao e apagado apos os testes (diferente dos mocks descartaveis usados
 * durante o desenvolvimento manual) — faz parte do harness de verificação.
 */
import express from "express";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const EXPECTED_APP = "e2e";
const EXPECTED_TOKEN = "e2e-token-abcdefgh";
const PORT = 4569;

let log = [];

function registrar(evento) {
  log.push({ ...evento, em: new Date().toISOString() });
}

function autenticado(req) {
  const appOk = (req.query.app ?? req.body?.app) === EXPECTED_APP;
  const tokenQuery = req.query.token;
  const tokenBody = req.body?.token;
  const tokenHeader =
    req.headers["x-sgp-token"] || (req.headers.authorization || "").replace("Token ", "");
  const tokenOk = [tokenQuery, tokenBody, tokenHeader].includes(EXPECTED_TOKEN);
  return appOk && tokenOk;
}

function exigirAuth(req, res) {
  if (!autenticado(req)) {
    res.status(401).json({ error: "unauthorized" });
    return true;
  }
  return false;
}

app.get("/", (_req, res) => res.json({ ok: true, service: "mock-sgp-e2e" }));

app.get("/_test/log", (_req, res) => res.json(log));
app.post("/_test/reset", (_req, res) => {
  log = [];
  res.json({ ok: true });
});

app.get("/api/os/ocorrencia/tipo/list/", (req, res) => {
  if (exigirAuth(req, res)) return;
  res.json([{ codigo: "1", descricao: "Sem conexao" }]);
});

app.post("/api/ura/tecnicos/", (req, res) => {
  if (exigirAuth(req, res)) return;
  res.json({ tecnicos: [{ id: "1", nome: "Tecnico E2E" }] });
});

app.post("/api/ura/ordemservico/list/", (req, res) => {
  if (exigirAuth(req, res)) return;
  res.json({
    paginacao: { total: 1 },
    ordens_servicos: [
      {
        os_id: "e2e-os-1",
        os_status: 0,
        motivo: "1",
        os_conteudo: "Cliente sem sinal (fixture e2e)",
        cliente_nome: "Cliente E2E",
        contrato_id: "1",
        endereco_logradouro: "Rua de Teste",
        endereco_numero: "1",
        endereco_bairro: "Centro",
        endereco_cidade: "Natal",
        endereco_ll: "-5.79,-35.21",
        os_data_agendamento: "2026-12-31 09:00:00",
      },
    ],
  });
});

app.post("/api/os/acaminho/id/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  registrar({ acao: "acaminho", osId: req.params.id });
  res.json({ ok: true });
});

app.post("/api/os/update/id/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  registrar({ acao: "status", osId: req.params.id, osStatus: req.body.os_status });
  res.json({ ok: true });
});

app.post("/api/os/anotacoes/add/id/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  registrar({ acao: "anotacao", osId: req.params.id, texto: req.body.anotacao });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`[mock-sgp-e2e] ouvindo em ${PORT}`));
