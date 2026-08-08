-- A HFX3652 e o rastreador dela.
--
-- Dado OPERACIONAL numa migracao, e nao no seed, de proposito: o seed roda a
-- cada boot do container e nao e lugar de dado de negocio. A migracao roda uma
-- vez, e o `ON CONFLICT DO NOTHING` a torna segura em qualquer ambiente que ja
-- tenha o carro (o de desenvolvimento tem).
--
-- Veículo real, nao fixture: placa HFX3652, Fiat Uno, rastreador PlataformaTK
-- 496538 — os mesmos que a operacao ja usa hoje no outro sistema. `provedorId`
-- NULO porque e carro da propria operacao ISPhub, e nao de um provedor.
--
-- A CREDENCIAL do fornecedor nao entra aqui: o texto cifrado depende da
-- CRYPTO_KEY de cada ambiente, e commita-lo amarraria producao a uma chave
-- versionada. Ela vem de PLATAFORMATK_KEY e e cifrada no boot (ver seed.ts).

INSERT INTO "veiculos" ("id", "placa", "modelo", "marca", "tipo", "status", "ativo", "criadoEm")
VALUES (gen_random_uuid()::text, 'HFX3652', 'Uno', 'Fiat', 'carro', 'ativo', true, CURRENT_TIMESTAMP)
ON CONFLICT ("placa") DO NOTHING;

INSERT INTO "rastreadores" ("id", "fornecedor", "identificadorExterno", "apelido", "ativo", "criadoEm")
VALUES (gen_random_uuid()::text, 'plataformatk', '496538', 'HFX-3652', true, CURRENT_TIMESTAMP)
ON CONFLICT ("fornecedor", "identificadorExterno") DO NOTHING;

-- O vinculo e um PERIODO, e o indice parcial garante um aberto por lado. O
-- `WHERE NOT EXISTS` cobre a reexecucao: sem ele, uma segunda passada tentaria
-- abrir um segundo vinculo e bateria no indice.
INSERT INTO "vinculos_rastreador" ("id", "veiculoId", "rastreadorId", "inicioEm")
SELECT gen_random_uuid()::text, v."id", r."id", CURRENT_TIMESTAMP
  FROM "veiculos" v, "rastreadores" r
 WHERE v."placa" = 'HFX3652'
   AND r."fornecedor" = 'plataformatk'
   AND r."identificadorExterno" = '496538'
   AND NOT EXISTS (
     SELECT 1 FROM "vinculos_rastreador" x
      WHERE x."veiculoId" = v."id" AND x."fimEm" IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM "vinculos_rastreador" y
      WHERE y."rastreadorId" = r."id" AND y."fimEm" IS NULL
   );
