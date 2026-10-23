import { createVerify, generateKeyPairSync } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assinarAssercao } from "./googleDrive.js";
import { lerAbas, lerZip } from "./xlsx.js";
import { linhasDaPlanilha } from "../services/planilhaSyncService.js";

/** Zip minimo (sem CRC conferido pelo leitor): `comprimir` decide store (0) ou deflate (8). */
function zip(arquivos: Record<string, string>, comprimir: (nome: string) => boolean = () => false): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [nome, texto] of Object.entries(arquivos)) {
    const cru = Buffer.from(texto);
    const metodo = comprimir(nome) ? 8 : 0;
    const dados = metodo === 8 ? deflateRawSync(cru) : cru;
    const n = Buffer.from(nome);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(n.length, 26);
    locais.push(local, n, dados);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(cru.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, n);
    offset += 30 + n.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

const planilha = () =>
  zip(
    {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Instrucoes" sheetId="1" r:id="rId1"/><sheet name="Agendamentos - Reparo" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Nº OS</t></si><si><r><t>Data </t></r><r><t>Agendada</t></r></si><si><t>Turno</t></si><si><t>Status</t></si><si><t>Atendente</t></si><si><t>Manhã</t></si><si><t>Ana &amp; Cia</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>leia-me</t></is></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml":
        `<worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>titulo</t></is></c></row>` +
        // cabecalho fora de ordem: Status antes de Turno
        `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>2</v></c><c r="E2" t="s"><v>4</v></c></row>` +
        `<row r="3"><c r="A3" t="str"><v>OS-213221</v></c><c r="B3" s="16"><v>46318</v></c><c r="C3"/><c r="D3" t="s"><v>5</v></c><c r="E3" t="s"><v>6</v></c></row>` +
        `<row r="4"/>` +
        `</sheetData></worksheet>`,
    },
    (nome) => nome.endsWith("sheet2.xml"), // uma comprimida, as outras nao
  );

describe("leitor de xlsx", () => {
  it("le zip com store e deflate", () => {
    const z = lerZip(planilha());
    expect(z.get("xl/worksheets/sheet1.xml")?.toString()).toContain("leia-me");
    expect(z.get("xl/worksheets/sheet2.xml")?.toString()).toContain("OS-213221");
  });

  it("le abas: compartilhada (inclusive em pedacos), numero, inlineStr, str e entidade", () => {
    const abas = lerAbas(planilha());
    expect([...abas.keys()]).toEqual(["Instrucoes", "Agendamentos - Reparo"]);
    const linhas = abas.get("Agendamentos - Reparo")!;
    expect(linhas[1]).toEqual(["Nº OS", "Data Agendada", "Status", "Turno", "Atendente"]);
    expect(linhas[2]![0]).toBe("OS-213221");
    expect(linhas[2]![1]).toBe(46318);
    expect(linhas[2]![2]).toBeNull();
    expect(linhas[2]![4]).toBe("Ana & Cia");
  });

  it("recusa o que nao e zip", () => {
    expect(() => lerZip(Buffer.from("nao sou zip nenhum, so texto comprido o bastante"))).toThrow(/zip/);
  });
});

describe("linhas da planilha", () => {
  it("le pelo NOME da coluna (fora de ordem) e pula linha vazia", () => {
    const linhas = linhasDaPlanilha(lerAbas(planilha()));
    expect(linhas).toEqual([
      { os: "213221", dia: "2026-10-23", turno: "manha", status: "", atendente: "Ana & Cia", aba: "reparo", tecnico: null, ordem: null, observacao: null },
    ]);
  });

  it("coluna obrigatoria sumida para o robo em vez de ler a coluna errada", () => {
    const abas = new Map([["Agendamentos - Instalacao", [["Nº OS", "Data Agendada", "Status", "Atendente"]]]]);
    expect(() => linhasDaPlanilha(abas)).toThrow(/turno/);
  });
});

describe("conta de servico do Google", () => {
  it("o JWT de assercao e RS256, verificavel com a chave publica, com escopo so leitura", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = assinarAssercao(
      { client_email: "robo@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      1_800_000_000_000,
    );
    const [cab, corpo, assinatura] = jwt.split(".");
    expect(JSON.parse(Buffer.from(cab!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const c = JSON.parse(Buffer.from(corpo!, "base64url").toString());
    expect(c).toMatchObject({ iss: "robo@proj.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/drive.readonly", iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(createVerify("RSA-SHA256").update(`${cab}.${corpo}`).verify(publicKey, Buffer.from(assinatura!, "base64url"))).toBe(true);
  });
});
