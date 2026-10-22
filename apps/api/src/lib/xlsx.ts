import { inflateRawSync } from "node:zlib";

/**
 * Leitor minimo de .xlsx, so pra o robo da planilha de agendamento.
 *
 * Um .xlsx e um zip de XMLs. Le o diretorio central do zip, descomprime com o
 * zlib do Node e tira das abas so o VALOR de cada celula (texto ou numero) —
 * sem formula, estilo nem formatacao. Nao vale uma dependencia pra isso.
 *
 * ponytail: sem zip64 (arquivo > 4 GB) e sem criptografia. A planilha tem ~100 KB.
 */

export type Celula = string | number | null;

/** Arquivo do zip -> conteudo descomprimido. */
export function lerZip(buf: Buffer): Map<string, Buffer> {
  // Fim do diretorio central: assinatura 0x06054b50, nos ultimos 64 KB (comentario do zip).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: nao e um zip valido");

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = new Map<string, Buffer>();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("xlsx: diretorio central corrompido");
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString("utf8", p + 46, p + 46 + lenNome);
    p += 46 + lenNome + lenExtra + lenComent;

    // O cabecalho local tem seus proprios tamanhos de nome/extra — podem diferir do central.
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamanho);
    if (metodo === 0) arquivos.set(nome, dados);
    else if (metodo === 8) arquivos.set(nome, inflateRawSync(dados));
    // outro metodo: ignora o arquivo (nenhum que o xlsx use)
  }
  return arquivos;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodificar(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e]!,
  );
}

/** Texto de um <si>/<is>: junta todos os <t> (texto com formatacao vem em pedacos). */
const textoDe = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decodificar(m[1]!)).join("");

/** "A" -> 0, "N" -> 13, "AA" -> 26. */
function colunaDe(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Nome da aba -> linhas (indice = linha do Excel - 1), cada uma com as celulas por coluna. */
export function lerAbas(buf: Buffer): Map<string, Celula[][]> {
  const zip = lerZip(buf);
  const ler = (nome: string) => zip.get(nome)?.toString("utf8") ?? "";

  const compartilhadas = [...ler("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]!));
  const alvos = new Map(
    [...ler("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])?.[1],
      /Target="([^"]+)"/.exec(m[0])?.[1],
    ]),
  );

  const abas = new Map<string, Celula[][]>();
  for (const m of ler("xl/workbook.xml").matchAll(/<sheet\s[^>]*>/g)) {
    const nome = decodificar(/name="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const alvo = alvos.get(/r:id="([^"]+)"/.exec(m[0])?.[1]);
    if (!alvo) continue;
    const xml = ler(alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`);

    const linhas: Celula[][] = [];
    for (const r of xml.matchAll(/<row\s[^>]*r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const linha: Celula[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        if (!ref) continue;
        const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
        const corpo = c[2] ?? "";
        const v = /<v>([^<]*)<\/v>/.exec(corpo)?.[1];
        let valor: Celula = null;
        if (tipo === "s") valor = v != null ? (compartilhadas[Number(v)] ?? null) : null;
        else if (tipo === "inlineStr") valor = textoDe(corpo);
        else if (tipo === "str" || tipo === "e") valor = v != null ? decodificar(v) : null;
        else if (tipo === "b") valor = v === "1" ? "TRUE" : "FALSE";
        else if (v != null && v !== "") valor = Number(v);
        linha[colunaDe(ref)] = valor;
      }
      linhas[Number(r[1]) - 1] = linha;
    }
    abas.set(nome, linhas);
  }
  return abas;
}
