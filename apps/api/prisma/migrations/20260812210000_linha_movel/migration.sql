-- Linha movel corporativa (chip CITmax/Brazmovel) do tecnico.
--
-- Aditiva: nenhuma coluna existente muda, nenhuma linha e reescrita.

-- A credencial da operadora. UMA para a operacao inteira — sem `provedor_id`,
-- porque os tecnicos sao funcionarios da propria operacao e o contrato com a
-- operadora e da CITmax.
CREATE TABLE "brazmovel_configs" (
    "id" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.brazmovel.com.br/v1',
    "tokenCifrado" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoTesteEm" TIMESTAMP(3),
    "ultimoTesteOk" BOOLEAN,
    "ultimoTesteMensagem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brazmovel_configs_pkey" PRIMARY KEY ("id")
);

-- O ponteiro para a linha do usuario. Guardamos o `lineId` da operadora, NAO o
-- CPF: o CPF e so a porta de descoberta, usada uma vez na tela de vinculo e
-- descartada. Ver o comentario do campo em schema.prisma.
ALTER TABLE "usuarios" ADD COLUMN "brazmovelLineId" TEXT;

-- UNIQUE de verdade — e este e o ponto de guardar o lineId em vez do CPF.
-- Com CPF cifrado por AES-GCM (IV aleatorio) o mesmo CPF produz ciphertexts
-- diferentes, e um indice unico nao detectaria duplicata nenhuma. Aqui, dois
-- usuarios apontando para a mesma linha e recusado pelo banco.
CREATE UNIQUE INDEX "usuarios_brazmovelLineId_key" ON "usuarios"("brazmovelLineId");
