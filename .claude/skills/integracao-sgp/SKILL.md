---
name: integracao-sgp
description: Integração bidirecional do ISPhub com o SGP de cada provedor — contrato ErpConnector (packages/shared), conector SGP, sync por polling com upsert idempotente e reconciliação de OS desaparecidas, write-back "SGP primeiro, espelho depois", campo protegido, conflitos de status, agenda confirmada pela leitura, credenciais cifradas e como testar sem SGP real. Use ao mexer em src/connectors/sgp.ts, connector.ts, syncService, writebackService, agendaService (confirmação no SGP), tecnicosSgpService, jobs de sync ou mapeamento de status.
---

# Integração SGP

O ISPhub é **espelho** das OS de cada provedor e escreve de volta no SGP dele. Erro aqui fecha OS viva, duplica anotação/foto no ERP do cliente ou deixa o provedor sem ver o que o técnico fez. Mudança nesta área é **risco alto** na skill `safe-change`; revise com `silent-failure-hunter` e `security-reviewer`.

Quem é dono de quê (ver também `docs/skills/isphub-audit/SKILL.md` §1):
- **SGP:** cadastro do cliente, contrato, dados da OS, status oficial.
- **ISPhub:** agenda de campo (`Agendamento`), turno, técnico alocado por gente, timeline (`OsEvento`), check-in, jornada.

## 1. Camadas
| Camada | Arquivo | Papel |
|---|---|---|
| Contrato | `packages/shared/src/connector.ts` (`ErpConnector`, `RawOs`, `ListagemOs`, `ResultadoStatusOs`) | Formato neutro de ERP. Cada método documenta a política de erro: leia antes de usar. |
| Conector | `apps/api/src/connectors/sgp.ts` (`createSgpConnector`, `SgpError`) | HTTP com o SGP, `AbortSignal.timeout`, normalização para `RawOs`. |
| Fábrica | `apps/api/src/services/erpConnectorService.ts` (`buildConnector`) | Único lugar que decifra `ErpConfig.tokenCifrado` e escolhe o conector. |
| Leitura | `apps/api/src/services/syncService.ts` (`syncProvedor`) + `src/jobs/syncScheduler.ts` | Polling por provedor (`intervaloPollingSegundos`), upsert no espelho, `SyncLog`. |
| Escrita | `apps/api/src/services/writebackService.ts` | Ações do usuário (a caminho, status, encerrar, anotação, evidência, técnico, contrato). |
| Agenda | `apps/api/src/services/agendaService.ts` (`confirmarComSgp`, `reenviarNaoConfirmadas`, `reconciliarDoSgp`, `ligarOrfas`) | Visita é do ISPhub; o SGP recebe cópia best-effort. |
| Técnicos | `apps/api/src/services/tecnicosSgpService.ts` (`espelharDespachoSgp`) | Espelha responsável/apoio designados no SGP por login vinculado. |
| Status | `packages/shared/src/status.ts` (`mapSgpOsStatus`, `sgpStatusReconhecido`, `toSgpOsStatus`) | Status cru pode vir número (`status_id`) ou texto; o número tem precedência. |

ERP novo = novo `ErpTipo` no schema + conector que implementa `ErpConnector` + `case` em `buildConnector`. O resto do sistema não deve saber qual ERP é.

## 2. Leitura (sync)
- **Serializado por provedor:** `syncProvedor` usa `comTravaExclusiva("sync:<provedorId>")`. No deploy, o contêiner velho e o novo rodam juntos; sem trava, eventos saem em dobro. Não chame `syncProvedorSemTrava` de fora.
- **Upsert idempotente** por `@@unique([provedorId, sgpOsId])`. Rodar o mesmo ciclo duas vezes não pode mudar nada nem avisar ninguém (`deveAvisarMudanca`).
- **O upsert nunca escreve `tecnicoId`**: técnico vem do espelho do despacho do SGP e técnico posto por gente no ISPhub vence.
- **Campo protegido:** por `CAMPO_PROTEGIDO_MS` (5 min) depois de uma ação humana, o sync não sobrescreve status/observação com o valor (possivelmente velho) que o SGP ainda devolve.
- **Conflito de status:** `reconciliarStatus` — cancelada localmente não vira concluída; "a caminho" não volta a "aberta" só porque o SGP ainda diz aberta. Regra nova de conflito entra aqui, pura e com teste.
- **OS que sumiu da listagem:** só se a varredura foi `completo: true`. Aí `obterStatusOs` (estrita) decide via `decidirSobreDesaparecida`: `indeterminado` nunca escreve; `ausente` precisa de `DESAPARECIMENTOS_PRA_CANCELAR` (3) ciclos seguidos; encerrada no SGP fecha na hora. Uma versão antiga tratou "não entendi a resposta" como "não existe" e cancelou OS viva.
- **Tetos por ciclo** (backfill de geo, confirmações de desaparecidas) e `comConcorrenciaLimitada` (`src/lib/limitador.ts`) protegem o SGP do provedor. Não troque por `Promise.all` sem limite.
- Datas do SGP vêm sem fuso: aplique `-03:00` (`packages/shared/src/dia.ts`) antes de virar `Date`.

## 3. Escrita (write-back)
- **SGP primeiro, espelho depois:** chame o conector via `chamarSgp(...)`; só no sucesso grave a OS e o `OsEvento` (na mesma transação local). Nunca chame o SGP dentro de `$transaction`.
- **Erros:** `chamarSgp` transforma recusa em `HttpError` com frase acionável (`mensagemAmigavelSgp`); 422 com mensagem de negócio do SGP vira 409 com a frase dele. Não engula: o técnico precisa saber se tenta de novo ou liga para o escritório.
- **Repetir só recusa 4xx** (`ehRecusa4xx`): em 5xx/timeout a escrita pode ter acontecido e repetir duplica. Outbox do app/painel reenvia; a API precisa tolerar o mesmo pedido duas vezes (ex.: "já encerrada" é sucesso em `encerrarOs`).
- **200 não é prova:** o SGP já ignorou campo em silêncio devolvendo 200 (`addOsNote`, `scheduleOs`). Onde importa, confirme pela leitura seguinte (`Agendamento.sgpConfirmadoEm`) e reenvie o não confirmado.
- **Evidências (fotos):** hospedadas no SGP, sem storage local; limite de 2 MB e jpeg/png/webp em `routes/ordensServico.ts`; download só de anexo listado para a OS acessível (anti-IDOR).
- Escopo: toda ação parte de uma rota que já conferiu `podeAcessarOs`/`exigirProvedor`; o serviço carrega a config SGP **do provedor da OS** (`loadOsWithConnector`), nunca de um `provedorId` vindo do cliente.

## 4. Credenciais e logs
- Token do SGP: cifrado com `encrypt` (`src/lib/crypto.ts`, AES-256-GCM, `CRYPTO_KEY` de 64 hex), decifrado só em `buildConnector`, devolvido mascarado (`maskToken`). URL do SGP validada contra SSRF (`validarUrlExterna`).
- Os GETs levam `token` na query: log de erro usa `origemSegura` (só a origem). `SGP_DEBUG_RAW` despeja PII de cliente: só ligado em investigação pontual e com segredos redigidos.
- Trocar `CRYPTO_KEY` invalida todas as credenciais cifradas (SGP, AtendAI, WhatsApp, SMTP, rastreador): exige recifrar, não é mudança de configuração simples.

## 5. Testar
- Lógica de decisão pura (`reconciliarStatus`, `decidirSobreDesaparecida`, `deveAvisarMudanca`) em `syncService.test.ts` / `syncService.reconciliacao.test.ts`.
- Write-back com conector e Prisma mockados: `writebackService.test.ts`, `concluirOs.test.ts`, `encerrarSemVisita.test.ts`. Cubra SGP recusando (4xx), caindo (5xx/timeout) e o espelho **não** mudando nesses casos.
- Conector: `src/connectors/sgp.test.ts` com `vi.stubGlobal("fetch", …)`; use respostas com status número **e** texto.
- Ponta a ponta: `apps/web/e2e/fixtures/mock-sgp-server.mjs` (porta 4569, `/_test/log` mostra o que o ISPhub enviou) com `cd apps/web && npx playwright test e2e/despacho.spec.ts`.
- Nunca teste contra o SGP real de um provedor sem pedido explícito: write-back muda o ERP do cliente e avisa o assinante.
