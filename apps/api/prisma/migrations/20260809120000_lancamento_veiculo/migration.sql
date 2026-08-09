-- LANCAMENTO -> VEICULO: o que destrava "quanto custa cada carro".
--
-- Hoje a UNICA ponte entre dinheiro e veiculo e `Abastecimento.lancamentoId`,
-- que e 1:1 e so cobre combustivel. Manutencao, pneu, seguro, IPVA, multa,
-- lavagem e pedagio, quando lancados, ficam num `Lancamento` sem dono — e o
-- "R$/km" do BI seria, na verdade, "R$/km de combustivel".
--
-- Opcional de proposito, e por duas razoes:
--
-- (a) a esmagadora maioria dos lancamentos NAO e de veiculo (mensalidade,
--     folha, internet). Obrigatorio, o campo forcaria um veiculo falso em toda
--     despesa da empresa;
-- (b) `SetNull` e nao `Cascade`: aposentar um veiculo nao pode apagar a despesa
--     que a empresa de fato teve. O historico financeiro sobrevive ao carro —
--     mesma decisao ja tomada em `VinculoRastreador` e `OcupacaoVeiculo`, que
--     usam `Restrict` pelo mesmo motivo.

ALTER TABLE "lancamentos" ADD COLUMN "veiculoId" TEXT;

ALTER TABLE "lancamentos"
  ADD CONSTRAINT "lancamentos_veiculoId_fkey"
  FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A consulta do BI e sempre "quanto este veiculo custou NESTE periodo".
-- `competencia` e nao `vencimento`: o BI pergunta o que o mes GEROU de custo, e
-- agregar por vencimento e o defeito que o DRE desta casa ja recusa
-- explicitamente (a mensalidade de marco que vence em abril nao e custo de
-- abril).
CREATE INDEX "lancamentos_veiculoId_competencia_idx" ON "lancamentos"("veiculoId", "competencia");
