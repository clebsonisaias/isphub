-- OsEvento: o status da transicao deixa de morar so dentro da frase.
--
-- Ate aqui, "esta OS foi concluida" era o texto
-- "Status alterado: A caminho → Concluida" em `descricao`, montado a partir dos
-- rotulos de TELA. Um BI de produtividade em cima disso e um `LIKE '%Concluida%'`
-- que passa a mentir no dia em que alguem corrigir o acento de um rotulo — sem
-- erro nenhum, so com o numero errado. E produtividade mede pessoas.
--
-- Aditivo: as colunas nascem nulas, e nulo aqui quer dizer "nao sabemos", nunca
-- "nao mudou".
ALTER TABLE "os_eventos" ADD COLUMN "statusDe" "OsStatus";
ALTER TABLE "os_eventos" ADD COLUMN "statusPara" "OsStatus";

-- BACKFILL — uma vez so, aqui, e nunca na leitura.
--
-- Parsear texto e exatamente o que estas colunas existem para evitar; a
-- diferenca e que aqui isso acontece UMA vez, sob revisao, contra as tres
-- formas que o codigo de fato gerou, e o que nao casar fica NULO em vez de
-- virar um palpite. As tres formas:
--
--   1. `writebackService.alterarStatus` — "Status alterado: <de> → <para>"
--   2. `writebackService.marcarACaminho` — "Marcado como a caminho" (sem origem)
--   3. `syncService` — "Encerrada no SGP (...)" / "Removida no SGP — ..."
--
-- Os rotulos abaixo sao os de `OS_STATUS_LABEL` (packages/shared/src/status.ts),
-- SEM acento em "Concluida" e "Em execucao", que e como eles estao escritos la.
-- Se um dia mudarem, este bloco nao acompanha — e nao precisa: ele ja rodou.

UPDATE "os_eventos" SET "statusPara" = 'em_deslocamento'
 WHERE tipo = 'status' AND descricao = 'Marcado como a caminho';

UPDATE "os_eventos" SET
  "statusDe" = CASE split_part(split_part(descricao, 'Status alterado: ', 2), ' → ', 1)
    WHEN 'Aberta'       THEN 'aberta'::"OsStatus"
    WHEN 'A caminho'    THEN 'em_deslocamento'::"OsStatus"
    WHEN 'Em execucao'  THEN 'em_execucao'::"OsStatus"
    WHEN 'Concluida'    THEN 'concluida'::"OsStatus"
    WHEN 'Cancelada'    THEN 'cancelada'::"OsStatus"
    WHEN 'Pendente'     THEN 'pendente'::"OsStatus"
  END,
  "statusPara" = CASE split_part(descricao, ' → ', 2)
    WHEN 'Aberta'       THEN 'aberta'::"OsStatus"
    WHEN 'A caminho'    THEN 'em_deslocamento'::"OsStatus"
    WHEN 'Em execucao'  THEN 'em_execucao'::"OsStatus"
    WHEN 'Concluida'    THEN 'concluida'::"OsStatus"
    WHEN 'Cancelada'    THEN 'cancelada'::"OsStatus"
    WHEN 'Pendente'     THEN 'pendente'::"OsStatus"
  END
 WHERE tipo = 'status' AND descricao LIKE 'Status alterado: % → %';

-- O sync encerrando/removendo pelo lado do SGP. Continuam SEM autor, e e essa
-- ausencia que a tela le como "fechou por fora do app" — nao um defeito.
UPDATE "os_eventos" SET "statusPara" = 'concluida'
 WHERE tipo = 'status' AND descricao LIKE 'Encerrada no SGP%';

UPDATE "os_eventos" SET "statusPara" = 'cancelada'
 WHERE tipo = 'status' AND descricao LIKE 'Removida no SGP%';

-- A consulta do BI: "todo fechamento no periodo", ja separando quem fechou.
CREATE INDEX "os_eventos_statusPara_criadoEm_autorId_idx"
    ON "os_eventos"("statusPara", "criadoEm", "autorId");
