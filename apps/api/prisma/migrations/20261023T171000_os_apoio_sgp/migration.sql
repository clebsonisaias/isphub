-- Tecnico e apoio que a OS ja tem no SGP, espelhados no ISPhub (tecnicosSgpService.espelharDespachoSgp).
ALTER TABLE "ordens_servico" ADD COLUMN "tecnicosAuxiliaresSgp" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "_OsApoio" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_OsApoio_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_OsApoio_B_index" ON "_OsApoio"("B");
ALTER TABLE "_OsApoio" ADD CONSTRAINT "_OsApoio_A_fkey" FOREIGN KEY ("A") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_OsApoio" ADD CONSTRAINT "_OsApoio_B_fkey" FOREIGN KEY ("B") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
