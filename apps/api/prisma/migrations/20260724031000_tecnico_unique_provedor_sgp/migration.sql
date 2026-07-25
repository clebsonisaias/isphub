-- AddUniqueConstraint on tecnicos(provedorId, sgpTecnicoId)
CREATE UNIQUE INDEX "tecnicos_provedorId_sgpTecnicoId_key" ON "tecnicos"("provedorId", "sgpTecnicoId");
