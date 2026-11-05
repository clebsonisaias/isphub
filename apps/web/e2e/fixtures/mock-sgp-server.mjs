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

/*
 * "OS do ERP", num unico array mutavel — e o que permite os specs simularem
 * abrir/fechar OS no SGP de verdade, em vez de so injetar OS novas. A seed
 * (e2e-os-1, aberta) e a mesma que a suite ja depende ha tempo; OS extras
 * injetadas por /_test/os entram aqui dentro tambem, pra tudo compartilhar o
 * mesmo mecanismo de status.
 */
const SEED = {
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
};

/*
 * A OS "sem tipo mapeado" tambem precisa EXISTIR no ERP.
 *
 * Ela nascia so no seed do banco do ISPhub. Depois que a reconciliacao passou
 * a cancelar OS que sumiu da varredura de abertas (comportamento correto: "nao
 * esta mais no SGP"), esta OS virava `cancelada` no primeiro ciclo de sync e
 * sumia do Painel. O teste que a procura so passava quando corria ANTES desse
 * ciclo — uma corrida que ele vinha ganhando por sorte.
 *
 * Sem `motivo`, entao o ISPhub nao acha TipoOs e ela segue com tipoOsId null,
 * que e exatamente a condicao que o teste quer exercitar.
 */
const SEED_SEM_TIPO = {
  os_id: "e2e-os-sem-tipo",
  os_status: 0,
  os_conteudo: "OS sem tipo mapeado (fixture e2e)",
  cliente_nome: "Cliente Sem Tipo",
  contrato_id: "2",
  os_data_agendamento: "2026-12-31 12:00:00",
};

/*
 * Retirada (equipe externa). Precisa existir AQUI, nao so no seed do banco:
 * a reconciliacao cancela toda OS aberta que nao aparece na varredura do SGP,
 * entao uma OS so-no-banco vira "cancelada" no primeiro ciclo de sync e some
 * do mapa — foi assim que a `e2e-os-sem-tipo` passava por sorte.
 *
 * `motivo` casa com o TipoOs de codigo 99, mapeado numa categoria com
 * equipeExterna=true: e o que faz o mapa desenhar losango em vez de circulo.
 */
const SEED_RETIRADA = {
  os_id: "e2e-os-retirada",
  os_status: 0,
  os_conteudo: "Retirada de equipamento (fixture e2e)",
  cliente_nome: "Cliente Retirada",
  contrato_id: "3",
  motivo: "99",
  endereco_ll: "-5.8,-35.22",
  os_data_agendamento: "2026-12-31 12:00:00",
};

/*
 * Contrato CANCELADO — exercita o halo de alerta do mapa. `contrato_status` e
 * o campo que o conector le (sgp.ts, normalizeOs); as demais OS de base tem
 * contrato ativo.
 */
const SEED_CANCELADA = {
  os_id: "e2e-os-cancelada",
  os_status: 0,
  os_conteudo: "OS de contrato cancelado (fixture e2e)",
  cliente_nome: "Cliente Contrato Cancelado",
  contrato_id: "4",
  contrato_status: "Cancelado",
  motivo: "1",
  endereco_ll: "-5.81,-35.23",
  os_data_agendamento: "2026-12-31 12:00:00",
};

/*
 * Contrato INATIVO — a UNICA origem que o tecnico pode mudar (Inativo -> Ativo).
 * Sem esta fixture o caso mais importante da regra de papel nao teria como ser
 * exercitado: com "Cancelado" o tecnico e barrado por motivo DIFERENTE, e o
 * teste passaria sem provar nada.
 */
const SEED_INATIVA = {
  os_id: "e2e-os-inativa",
  os_status: 0,
  os_conteudo: "OS de contrato inativo (fixture e2e)",
  cliente_nome: "Cliente Contrato Inativo",
  contrato_id: "5",
  contrato_status: "Inativo",
  motivo: "1",
  os_data_agendamento: "2026-12-31 12:00:00",
};

/*
 * OS DESCARTAVEL, so para os testes que MUDAM o status do contrato.
 *
 * Existe porque mudar o contrato de uma OS que outro spec LE quebra aquele spec
 * conforme a ORDEM da suite. Aconteceu: os testes de admin mudavam a
 * SEED_CANCELADA e o mapa.spec, que conta o halo de contrato irregular, passava
 * sozinho e falhava na suite inteira.
 *
 * Sem `endereco_ll` de proposito — assim nao vira marcador e fica fora da
 * contagem do mapa.
 */
const SEED_MUTAVEL = {
  os_id: "e2e-os-mutavel",
  os_status: 0,
  os_conteudo: "OS de contrato mutavel (fixture e2e)",
  cliente_nome: "Cliente Contrato Mutavel",
  contrato_id: "6",
  contrato_status: "Inativo",
  motivo: "1",
  os_data_agendamento: "2026-12-31 12:00:00",
};

let ordens = [
  { ...SEED },
  { ...SEED_SEM_TIPO },
  { ...SEED_RETIRADA },
  { ...SEED_CANCELADA },
  { ...SEED_INATIVA },
  { ...SEED_MUTAVEL },
];

app.get("/", (_req, res) => res.json({ ok: true, service: "mock-sgp-e2e" }));

app.get("/_test/log", (_req, res) => res.json(log));
app.post("/_test/reset", (_req, res) => {
  log = [];
  /*
   * Tem que restaurar TODAS as OS de base — a lista aqui e a linha de base do
   * SGP, e o que ela esquecer some do ERP simulado. Uma OS de base ausente e
   * cancelada pela reconciliacao ("saiu da fila de abertas") no ciclo
   * seguinte, e o spec que dependia dela falha so quando a suite roda inteira,
   * nunca sozinho. Foi o que aconteceu com a retirada do mapa.
   */
  ordens = [
    { ...SEED },
    { ...SEED_SEM_TIPO },
    { ...SEED_RETIRADA },
    { ...SEED_CANCELADA },
    { ...SEED_INATIVA },
    { ...SEED_MUTAVEL },
  ];
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

/*
 * OS extras injetadas pelo teste via POST /_test/os — e como o e2e simula
 * "abriram uma OS nova no ERP" sem depender de um SGP de verdade.
 */
app.post("/_test/os", (req, res) => {
  ordens.push(req.body);
  res.json({ ok: true, total: ordens.length });
});

/*
 * Muda o status de uma OS ja existente no "ERP" — e como o e2e simula
 * "fecharam a OS no SGP" sem depender de um SGP real. Precisa mexer nos DOIS
 * lugares que o sync consulta: a listagem (pra ela sumir das varreduras de
 * aberta) e a consulta por id (pra `obterStatusOs` enxergar o status novo).
 */
app.post("/_test/os/:id/status", (req, res) => {
  const os = ordens.find((o) => String(o.os_id) === req.params.id);
  if (!os) return res.status(404).json({ error: "OS nao encontrada no fixture" });
  os.os_status = req.body.os_status;
  res.json({ ok: true });
});

app.post("/api/ura/ordemservico/list/", (req, res) => {
  if (exigirAuth(req, res)) return;
  // O sync real sempre passa `status` explicito (uma chamada por status
  // aberto). Filtrar de verdade aqui e o que torna possivel testar "a OS
  // fechou no SGP" — sem isso ela nunca sumiria das varreduras de aberta,
  // que e justamente o mecanismo que expos o bug original.
  const filtro = req.body.status;
  const filtradas = filtro === undefined ? ordens : ordens.filter((o) => Number(o.os_status) === Number(filtro));
  res.json({ paginacao: { total: filtradas.length }, ordens_servicos: filtradas });
});

/*
 * Ficha da OS por id. Faltava aqui, e a ausencia MENTIA: o ambiente local
 * mostrava "o SGP nao devolveu dados desta OS" em toda OS, indistinguivel de
 * um defeito de producao. Um fixture que nao implementa a rota nao e neutro —
 * ele fabrica um sintoma.
 *
 * Tambem e o endpoint que `obterStatusOs` usa pra reconciliar OS que saiu da
 * fila de abertas — por isso o status devolvido aqui reflete o array `ordens`
 * mutavel, e nao um valor fixo.
 */
app.post("/api/os/list/id/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  if (req.params.id === "inexistente") return res.json({ ordens_servicos: [] });
  const conhecida = ordens.find((o) => String(o.os_id) === req.params.id);
  if (!conhecida) return res.json({ ordens_servicos: [] });
  res.json({
    ordens_servicos: [
      {
        os_id: req.params.id,
        os_status: conhecida.os_status,
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

// "Chamado – Atualizar": por onde o ISPhub encerra (encerrarOs) e agenda.
// So `os_id` na resposta prova que gravou — igual ao SGP real.
app.post("/api/central/chamado/update/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  if (req.body.os_status !== undefined) registrar({ acao: "status", osId: req.params.id, osStatus: req.body.os_status });
  res.json({ msg: "OS alterada com sucesso", os_id: req.params.id });
});

/**
 * Muda o status do contrato. Guarda o texto correspondente ao codigo REST na OS
 * — assim o proximo ciclo de sync devolve o valor novo, e o teste consegue
 * verificar que a mudanca ATRAVESSOU (nao so que a API respondeu 200).
 */
const ROTULO_STATUS_CONTRATO = {
  1: "Ativo",
  2: "Inativo",
  3: "Cancelado",
  4: "Suspenso",
  5: "Inviabilidade tecnica",
  6: "Novo",
  7: "Velocidade reduzida",
};

app.post("/api/ura/contrato/status/edit/", (req, res) => {
  const { contrato, status } = req.body ?? {};
  log.push({ rota: "contrato/status/edit", contrato, status });
  const rotulo = ROTULO_STATUS_CONTRATO[status];
  if (!rotulo) return res.status(400).json({ erro: `status invalido: ${status}` });
  for (const os of ordens) {
    if (String(os.contrato_id) === String(contrato)) os.contrato_status = rotulo;
  }
  res.json({ msg: "ok" });
});

app.post("/api/os/anotacoes/add/id/:id/", (req, res) => {
  if (exigirAuth(req, res)) return;
  registrar({ acao: "anotacao", osId: req.params.id, texto: req.body.anotacao });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`[mock-sgp-e2e] ouvindo em ${PORT}`));
