import { OsStatus, type FilaItem, type TurnoAgenda } from "@isphub/shared";

/**
 * MARCAR VISITA — a busca da atendente ao telefone e os rótulos que ela lê
 * para o cliente. Lógica pura, com teste.
 */

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const digitos = (s: string) => s.replace(/\D/g, "");

/**
 * As OS que batem com o que a atendente digitou. Só números (com ou sem
 * pontuação) procura no nº da OS, contrato, protocolo, CPF/CNPJ e telefone;
 * texto procura no nome do cliente, cada palavra em qualquer ordem e sem
 * acento ("maria carmo" acha "Maria do Carmo"). Nº da OS ou contrato exato vem
 * primeiro; depois quem ainda não tem visita.
 */
export function buscarOs(itens: FilaItem[], termo: string, limite = 20): FilaItem[] {
  const t = termo.trim();
  const d = digitos(t);
  const soNumero = d.length > 0 && /^[\d\s.\-/()]+$/.test(t);
  if (soNumero ? d.length < 3 : t.length < 2) return [];

  const palavras = semAcento(t).split(/\s+/).filter(Boolean);
  const bate = (i: FilaItem) =>
    soNumero
      ? [i.sgpOsId, i.contratoId, i.protocolo, i.clienteDocumento, i.telefone].some((c) => c && digitos(c).includes(d))
      : palavras.every((p) => semAcento(i.clienteNome ?? "").includes(p));
  const exato = (i: FilaItem) => soNumero && (digitos(i.sgpOsId) === d || digitos(i.contratoId ?? "") === d);

  return itens
    .filter(bate)
    .sort(
      (a, b) =>
        Number(exato(b)) - Number(exato(a)) ||
        Number(!!a.diaAgenda) - Number(!!b.diaAgenda) ||
        (b.dataCadastro ?? "").localeCompare(a.dataCadastro ?? ""),
    )
    .slice(0, limite);
}

/**
 * "Falta marcar": OS aberta sem visita, a mais antiga primeiro (é a que espera
 * há mais tempo). Em deslocamento/execução o técnico já está nela. Pendente
 * tem aba própria (/pendentes) — a busca ainda a acha, para remarcar quando o
 * cliente responder. Retirada não entra porque a página já pede só a fila da
 * equipe interna.
 */
export function faltaMarcar(itens: FilaItem[]): FilaItem[] {
  return itens
    .filter((i) => !i.diaAgenda && i.status === OsStatus.ABERTA)
    .sort((a, b) => (a.dataCadastro ?? "9").localeCompare(b.dataCadastro ?? "9"));
}

const DIA_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ddmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** "sábado, 24/10, de manhã" — como a atendente fala com o cliente. */
export function rotuloLongo(dia: string, turno: TurnoAgenda): string {
  const d = new Date(`${dia}T12:00:00Z`);
  return `${DIA_LONGO[d.getUTCDay()]}, ${ddmm(d)}, ${turno === "manha" ? "de manhã" : "à tarde"}`;
}

/** "Sáb 24/10" — o dia no botão da vaga. */
export function rotuloCurto(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  return `${DIA_CURTO[d.getUTCDay()]} ${ddmm(d)}`;
}
