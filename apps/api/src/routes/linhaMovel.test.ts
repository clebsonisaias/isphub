import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A garantia de isolamento da rota `GET /linha-movel/minha`.
 *
 * O token da Brazmovel vale para a base INTEIRA da CITmax, entao a unica coisa
 * que impede um tecnico de ler a linha de um colega e o servidor resolver qual
 * linha buscar **sozinho**, pelo id do usuario do JWT.
 *
 * Isso NAO e uma checagem de autorizacao que alguem pode esquecer de escrever —
 * e a ausencia do parametro: nao ha onde escrever "a linha do fulano". Conferido
 * contra a API real nesta sessao: `?lineId=`, `?brazmovelLineId=` e `?linha=`
 * com o id da linha de OUTRA pessoa continuaram devolvendo a linha do proprio
 * usuario.
 *
 * Este teste existe porque essa protecao e feita de uma AUSENCIA, e ausencias
 * nao quebram teste nenhum quando desaparecem. Um `req.query.lineId` acrescentado
 * "para o gestor tambem poder consultar" passaria por qualquer revisao e abriria
 * a base inteira.
 */
describe("GET /linha-movel/minha", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./linhaMovel.ts", import.meta.url)), "utf8");

  /** O corpo do handler de `/minha`, ate o proximo registro de rota. */
  const handlerMinha = (() => {
    const inicio = fonte.indexOf('"/minha"');
    expect(inicio, "a rota /minha sumiu ou foi renomeada").toBeGreaterThan(-1);
    const proximo = fonte.indexOf("linhaMovelRouter.", inicio);
    return fonte.slice(inicio, proximo === -1 ? fonte.length : proximo);
  })();

  it("não lê nada que venha do cliente", () => {
    for (const entrada of ["req.query", "req.body", "req.params"]) {
      expect(
        handlerMinha,
        `o handler passou a ler ${entrada} — a linha consultada deixou de ser ` +
          `decidida só pelo token, e um técnico pode pedir a de um colega`,
      ).not.toContain(entrada);
    }
  });

  it("resolve a linha pelo id do usuário do token", () => {
    expect(handlerMinha).toContain("req.user!.sub");
  });

  it("recusa PROVEDOR explicitamente", () => {
    // PROVEDOR e um ISP externo, cliente da operacao — nunca tem chip
    // corporativo. Sem esta guarda ele receberia "sem_vinculo", que funciona por
    // acidente e nao por decisao.
    expect(handlerMinha).toContain("requireRole(");
    expect(handlerMinha).not.toContain("UserRole.PROVEDOR");
  });
});
