import { randomBytes } from "node:crypto";
import { UserRole } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";
import { encrypt } from "./lib/crypto.js";
import { hashPassword } from "./services/authService.js";
import { importarDoFornecedor } from "./services/rastreadorService.js";

/**
 * Seed minimo: garante que exista um usuario admin para o primeiro acesso.
 * Se ja existir, nao faz nada (idempotente). A senha e gerada aleatoriamente
 * e impressa uma unica vez — nunca fica hardcoded no repositorio.
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@isphub.com.br";

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`Usuario admin ja existe (${email}). Nada a fazer.`);
    return;
  }

  const senha = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  const senhaHash = await hashPassword(senha);

  await prisma.usuario.create({
    data: {
      nome: "Administrador ISPhub",
      email,
      senhaHash,
      role: UserRole.ADMIN,
    },
  });

  console.log("Usuario admin criado com sucesso:");
  console.log(`  email: ${email}`);
  console.log(`  senha: ${senha}`);
  console.log("Guarde esta senha agora — ela nao sera exibida novamente.");
}

/**
 * Credencial do rastreador a partir do ambiente.
 *
 * A chave NAO pode vir cifrada no repositorio: o texto cifrado depende da
 * `CRYPTO_KEY` de cada ambiente, e commitar isso amarraria a producao a uma
 * chave que estaria no git. Entao ela chega por variavel de ambiente
 * (`PLATAFORMATK_KEY`, a mesma que o Maxxi ja usa) e e cifrada aqui, no boot,
 * com a CRYPTO_KEY do ambiente que esta subindo.
 *
 * So cria se ainda NAO houver credencial. Nunca sobrescreve o que um admin
 * configurou pela tela — a variavel e o ponto de partida, nao a autoridade.
 */
async function semearCredencialRastreador() {
  const chave = process.env.PLATAFORMATK_KEY?.trim();
  if (!chave) return;

  const existente = await prisma.rastreadorConfig.findFirst({
    where: { provedorId: null, fornecedor: "plataformatk" },
    select: { id: true },
  });
  if (existente) {
    /*
     * A REGRA CONTINUA SENDO NAO SOBRESCREVER — a variavel e o ponto de
     * partida, nao a autoridade. `PLATAFORMATK_KEY_APLICAR` e a excecao, e ela
     * existe porque a chave do fornecedor E POR CONTA: quando a operacao troca
     * de conta, alguem precisa conseguir trocar a chave sem ter acesso ao
     * banco, e ate aqui o unico caminho era a tela (que exige login de admin).
     *
     * Deliberadamente uma variavel SEPARADA, e nao "atualiza quando mudar":
     * assim um deploy comum nunca reverte uma chave que um admin trocou pela
     * tela. Quem liga isto esta declarando a intencao, e o log registra.
     * Desligue depois de aplicar.
     */
    if (process.env.PLATAFORMATK_KEY_APLICAR !== "1") {
      console.log("[frota] credencial de rastreamento ja configurada. Nada a fazer.");
      return;
    }
    await prisma.rastreadorConfig.update({
      where: { id: existente.id },
      data: { chaveCifrada: encrypt(chave), ultimaColetaOk: null, ultimaColetaMensagem: null },
    });
    console.log("[frota] credencial SOBRESCRITA por PLATAFORMATK_KEY_APLICAR=1. Desligue a variavel.");
    return;
  }

  await prisma.rastreadorConfig.create({
    data: { provedorId: null, fornecedor: "plataformatk", chaveCifrada: encrypt(chave) },
  });
  console.log("[frota] credencial de rastreamento criada a partir de PLATAFORMATK_KEY (cifrada).");
}

/**
 * Importa rastreadores DECLARADOS numa variavel de ambiente.
 *
 * Formato: `FROTA_IMPORTAR="537969:RGI4H16,538305:QGJ4A90"` — o id do aparelho
 * no fornecedor e a PLACA do carro, confirmada por quem escreveu.
 *
 * Existe pela mesma razao da chave: quando a operacao troca de conta no
 * fornecedor, a frota inteira que o ISPhub enxerga muda, e cadastrar aparelho
 * por aparelho exige uma sessao de admin no painel. A variavel e a mesma
 * declaracao que a tela faria — com a diferenca de ficar registrada na
 * configuracao do ambiente, onde da pra auditar depois.
 *
 * A PLACA vem escrita, e nao adivinhada do apelido do aparelho: e a mesma regra
 * da tela de importacao. Um palpite aceito em silencio vincularia o rastreador
 * ao carro de outra pessoa, e dali em diante o mapa, as viagens e o custo por
 * quilometro ficariam todos no veiculo errado.
 *
 * IDEMPOTENTE: aparelho ja cadastrado e pulado. Rodar de novo nao duplica nada.
 */
async function importarFrotaDeclarada() {
  const bruto = process.env.FROTA_IMPORTAR?.trim();
  if (!bruto) return;

  const itens = bruto
    .split(",")
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const [id, placa] = par.split(":").map((x) => x?.trim() ?? "");
      return { identificadorExterno: id, placa };
    })
    .filter((x) => x.identificadorExterno && x.placa);

  if (itens.length === 0) {
    console.warn(`[frota] FROTA_IMPORTAR nao tem par valido ("id:PLACA"): ${bruto}`);
    return;
  }

  // O autor do vinculo. FK obrigatoria — sem admin nao ha o que registrar.
  const admin = await prisma.usuario.findFirst({ where: { role: UserRole.ADMIN }, select: { id: true } });
  if (!admin) {
    console.warn("[frota] FROTA_IMPORTAR ignorada: nenhum admin cadastrado para assinar o vinculo.");
    return;
  }

  const jaTemos = new Set(
    (await prisma.rastreador.findMany({ select: { identificadorExterno: true } })).map(
      (x) => x.identificadorExterno,
    ),
  );
  const novos = itens.filter((x) => !jaTemos.has(x.identificadorExterno));
  if (novos.length === 0) {
    console.log("[frota] FROTA_IMPORTAR: todos os aparelhos declarados ja estao cadastrados.");
    return;
  }

  const feitos = await importarDoFornecedor(novos, null, admin.id);
  for (const f of feitos) {
    console.log(
      `[frota] importado ${f.identificadorExterno} -> ${f.placa}` +
        (f.veiculoCriado ? " (veiculo criado; complete marca/modelo/ano)" : " (vinculado a veiculo existente)"),
    );
  }
  console.log("[frota] FROTA_IMPORTAR aplicada. Desligue a variavel para nao repetir a leitura.");
}

main()
  .then(semearCredencialRastreador)
  .then(importarFrotaDeclarada)
  .catch((err) => {
    console.error("Falha ao rodar o seed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
