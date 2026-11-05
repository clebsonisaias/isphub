import { describe, expect, it } from "vitest";
import { OsStatus, type FilaItem } from "@isphub/shared";
import { buscarOs, faltaMarcar, rotuloCurto, rotuloLongo } from "./marcarVisita";

const os = (o: Partial<FilaItem>) =>
  ({ id: o.sgpOsId, sgpOsId: "1", clienteNome: null, contratoId: null, protocolo: null, clienteDocumento: null, telefone: null, diaAgenda: null, dataCadastro: "2026-10-20", ...o }) as FilaItem;

const itens = [
  os({ sgpOsId: "213347", clienteNome: "Maria do Carmo Silva", contratoId: "23871", clienteDocumento: "047.595.064-03", telefone: "(84) 99812-4410" }),
  os({ sgpOsId: "213350", clienteNome: "Maria José Pereira", contratoId: "213347", diaAgenda: "2026-10-26", dataCadastro: "2026-10-22" }),
  os({ sgpOsId: "213351", clienteNome: "Antônio Marcos Dantas", contratoId: "31207" }),
];

describe("busca da atendente", () => {
  it("nome: palavras em qualquer ordem, sem acento e sem caixa", () => {
    expect(buscarOs(itens, "carmo maria").map((i) => i.sgpOsId)).toEqual(["213347"]);
    expect(buscarOs(itens, "antonio").map((i) => i.sgpOsId)).toEqual(["213351"]);
    expect(buscarOs(itens, "maria").map((i) => i.sgpOsId)).toEqual(["213347", "213350"]);
  });

  it("CPF e telefone com ou sem pontuação", () => {
    expect(buscarOs(itens, "04759506403").map((i) => i.sgpOsId)).toEqual(["213347"]);
    expect(buscarOs(itens, "047.595.064-03").map((i) => i.sgpOsId)).toEqual(["213347"]);
    expect(buscarOs(itens, "99812 4410").map((i) => i.sgpOsId)).toEqual(["213347"]);
  });

  it("nº exato da OS ou do contrato vem primeiro; depois quem não tem visita", () => {
    // "213347" é a OS da Maria do Carmo e o contrato da Maria José.
    expect(buscarOs(itens, "213347").map((i) => i.sgpOsId)).toEqual(["213347", "213350"]);
    expect(buscarOs(itens, "2133").map((i) => i.sgpOsId)).toEqual(["213347", "213351", "213350"]);
  });

  it("termo curto demais não busca", () => {
    expect(buscarOs(itens, "m")).toEqual([]);
    expect(buscarOs(itens, "21")).toEqual([]);
  });
});

describe("falta marcar", () => {
  it("só aberta sem visita, a mais antiga primeiro (pendente tem aba própria)", () => {
    const lista = [
      os({ sgpOsId: "1", status: OsStatus.ABERTA, dataCadastro: "2026-10-22" }),
      os({ sgpOsId: "2", status: OsStatus.ABERTA, dataCadastro: "2026-10-20", diaAgenda: "2026-10-30" }),
      os({ sgpOsId: "3", status: OsStatus.EM_EXECUCAO, dataCadastro: "2026-10-19" }),
      os({ sgpOsId: "4", status: OsStatus.PENDENTE, dataCadastro: "2026-10-18" }),
      os({ sgpOsId: "5", status: OsStatus.ABERTA, dataCadastro: null }),
    ];
    expect(faltaMarcar(lista).map((i) => i.sgpOsId)).toEqual(["1", "5"]);
  });

  it("a busca ainda acha a pendente: é por ela que se remarca quando o cliente responde", () => {
    const pendente = os({ sgpOsId: "213399", clienteNome: "José Sem Retorno", status: OsStatus.PENDENTE });
    expect(faltaMarcar([pendente])).toEqual([]);
    expect(buscarOs([pendente], "sem retorno").map((i) => i.sgpOsId)).toEqual(["213399"]);
  });
});

describe("rótulos da vaga", () => {
  it("longo para falar com o cliente, curto para o botão", () => {
    expect(rotuloLongo("2026-10-24", "manha")).toBe("sábado, 24/10, de manhã");
    expect(rotuloLongo("2026-10-26", "tarde")).toBe("segunda, 26/10, à tarde");
    expect(rotuloCurto("2026-10-24")).toBe("Sáb 24/10");
  });
});
