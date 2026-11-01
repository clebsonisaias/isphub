import { describe, expect, it } from "vitest";
import type { RawOs } from "@isphub/shared";
import { vendedorPode } from "../middleware/auth.js";
import { formSchema } from "../routes/preCadastro.js";
import { corpoParaAtendai, escolherOsInstalacao, type FormularioPreCadastro } from "./preCadastroService.js";

const os = (sgpOsId: string, tipoDescricao: string, statusCode: number | string = 0): RawOs => ({
  sgpOsId,
  tipoDescricao,
  statusCode,
  endereco: {},
});

describe("escolherOsInstalacao", () => {
  it("pega a de instalação aberta, mesmo com outra OS no contrato", () => {
    expect(escolherOsInstalacao([os("10", "Venda"), os("11", "INSTALAÇÃO FIBRA")])?.sgpOsId).toBe("11");
  });
  it("entre duas de instalação abertas, a mais nova", () => {
    expect(escolherOsInstalacao([os("9", "Instalação"), os("12", "Instalação")])?.sgpOsId).toBe("12");
  });
  it("ignora a encerrada", () => {
    expect(escolherOsInstalacao([os("12", "Instalação", 1)])).toBeNull();
  });
  it("sem 'instalação' no tipo: uma única aberta serve, duas são ambíguas", () => {
    expect(escolherOsInstalacao([os("5", "Ativação")])?.sgpOsId).toBe("5");
    expect(escolherOsInstalacao([os("5", "Ativação"), os("6", "Visita")])).toBeNull();
  });
  it("lista vazia: ainda não apareceu", () => {
    expect(escolherOsInstalacao([])).toBeNull();
  });
});

const form: FormularioPreCadastro = {
  nome: " Maria da Silva ",
  cpfCnpj: "529.982.247-25",
  nascimento: "10/02/1990",
  celular: "(84) 99999-1234",
  email: "",
  plano: { id: 12, nome: "500 Mega" },
  vencimentoDia: 10,
  logradouro: "Rua das Flores",
  numero: "",
  complemento: "Casa B",
  referencia: "Portão azul",
  bairro: "Centro",
  cidade: "Macaíba",
  cep: "59280-000",
  popId: 3,
  portadorId: 1,
  nasId: null,
};

describe("corpoParaAtendai", () => {
  it("usa os nomes da tool cadastrar_cliente e só dígitos onde o SGP espera", () => {
    expect(corpoParaAtendai(form)).toEqual({
      nome: "Maria da Silva",
      cpf_cnpj: "52998224725",
      plano_id: 12,
      vencimento_dia: 10,
      logradouro: "Rua das Flores",
      numero: "S/N",
      complemento: "Casa B · Ref.: Portão azul",
      bairro: "Centro",
      cidade: "Macaíba",
      nascimento: "10/02/1990",
      celular: "84999991234",
      cep: "59280000",
      pop_id: 3,
      portador_id: 1,
    });
  });
});

describe("API: campos obrigatórios", () => {
  const ok = {
    nome: "Maria da Silva",
    cpfCnpj: "529.982.247-25",
    nascimento: "10/02/1990",
    celular: "(84) 99999-1234",
    email: "maria@exemplo.com.br",
    plano: { id: 12, nome: "500 Mega" },
    vencimentoDia: 10,
    logradouro: "Rua das Flores",
    bairro: "Centro",
    cidade: "Macaíba",
    cep: "59280-000",
  };
  const campos = (r: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
    r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

  it("formulário completo passa", () => {
    expect(formSchema.safeParse(ok).success).toBe(true);
  });
  it.each(["email", "cep", "celular"] as const)("sem %s é recusado", (campo) => {
    const { [campo]: _fora, ...resto } = ok;
    expect(campos(formSchema.safeParse(resto))).toContain(campo);
  });
  it("CPF sem nascimento é recusado; CNPJ não precisa", () => {
    expect(campos(formSchema.safeParse({ ...ok, nascimento: "" }))).toContain("nascimento");
    expect(formSchema.safeParse({ ...ok, cpfCnpj: "12.345.678/0001-90", nascimento: null }).success).toBe(true);
  });
  it("CPF com dígito errado é recusado", () => {
    expect(campos(formSchema.safeParse({ ...ok, cpfCnpj: "529.982.247-24" }))).toContain("cpfCnpj");
  });
  it("CEP incompleto e e-mail inválido são recusados", () => {
    expect(campos(formSchema.safeParse({ ...ok, cep: "5928" }))).toContain("cep");
    expect(campos(formSchema.safeParse({ ...ok, email: "maria@" }))).toContain("email");
  });
});

describe("vendedor: só o pré-cadastro", () => {
  it("alcança o pré-cadastro e a própria sessão", () => {
    expect(vendedorPode("GET", "/pre-cadastro/cobertura?lat=1&lng=2")).toBe(true);
    expect(vendedorPode("POST", "/pre-cadastro")).toBe(true);
    expect(vendedorPode("POST", "/pre-cadastro/abc/agendar")).toBe(true);
    expect(vendedorPode("POST", "/auth/login")).toBe(true);
    expect(vendedorPode("GET", "/eventos")).toBe(true);
  });
  it("fila, OS, agenda e administração ficam fechadas", () => {
    expect(vendedorPode("GET", "/fila")).toBe(false);
    expect(vendedorPode("GET", "/ordens-servico/abc")).toBe(false);
    expect(vendedorPode("POST", "/agenda")).toBe(false);
    expect(vendedorPode("GET", "/agenda/vagas")).toBe(false);
    expect(vendedorPode("GET", "/usuarios")).toBe(false);
    expect(vendedorPode("GET", "/pre-cadastros-falsos")).toBe(false);
  });
});
