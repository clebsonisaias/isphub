-- Veiculo: como a operacao CHAMA o carro, ao lado de como o Denatran o
-- identifica.
--
-- Placa identifica; apelido RECONHECE. Num mapa com quatro pontos ninguem
-- lembra qual e RGI4H16 — e a propria plataforma do rastreador ja batiza os
-- aparelhos assim ("C011 - RGI4H16"), porque quem opera precisa disso.
--
-- Aditivo e nulo: carro sem apelido continua identificado pela placa, que
-- segue sendo a chave.
ALTER TABLE "veiculos" ADD COLUMN "apelido" VARCHAR(40);
