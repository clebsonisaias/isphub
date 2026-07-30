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

/*
 * Ficha da OS por id. Faltava aqui, e a ausencia MENTIA: o ambiente local
 * mostrava "o SGP nao devolveu dados desta OS" em toda OS, indistinguivel de
 * um defeito de producao. Um fixture que nao implementa a rota nao e neutro —
 * ele fabrica um sintoma.
 */
app.post("/api/os/list/id/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  if (req.params.id === "inexistente") return res.json({ ordens_servicos: [] });
  res.json({
    ordens_servicos: [
      {
        os_id: req.params.id,
        os_status: 0,
        os_observacao: "Observacao vinda do SGP (fixture e2e)",
        os_servicoprestado: "Troca de ONU",
        os_tecnico_responsavel: "Tecnico E2E",
        os_setor: "Suporte",
        endereco_complemento: "Bloco B, ap 302",
        endereco_pontoreferencia: "Portao azul, ao lado da padaria",
        servico_online: true,
        servico_online_ip: "100.64.0.10",
        servico_online_mac: "AA:BB:CC:DD:EE:FF",
      },
    ],
  });
});

/*
 * Cadastro do contrato — de onde sai o PPPoE de verdade (`servico_login`), o
 * sinal optico da ONU e os dados do assinante.
 */
app.post("/api/ura/clientes/", (req, res) => {
  if (exigirAuth(req, res)) return;
  res.json({
    clientes: [
      {
        // Nome de proposito DIFERENTE do `cliente_nome` da OS: e assim que o
        // teste prova que o bloco "Cliente" da ficha vem do CADASTRO do
        // contrato, e nao do payload da OS.
        nome: "ASSINANTE CADASTRO E2E",
        cpfcnpj: "12345678900",
        email: "cliente-e2e@exemplo.com",
        telefone: "84999990000",
        contratos: [
          {
            contratoStatusDisplay: "Ativo",
            servicos: [
              {
                servico_login: "pppoe-e2e",
                servico_password: "senha-e2e",
                servico_plano: "FIBRA 500MB",
                onu: { rx: "-21.5", tx: "2.1", olt_nome: "OLT-E2E" },
              },
            ],
          },
        ],
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
