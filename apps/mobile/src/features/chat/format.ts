import { ConversaTipo, MensagemTipo, type ConversaResumo } from "@isphub/shared";

/** Iniciais do nome (ate 2 letras) pro avatar circular. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const letras = partes.length > 1 ? [partes[0][0], partes[partes.length - 1][0]] : [partes[0]?.[0] ?? "?"];
  return letras.join("").toUpperCase();
}

/** "Hoje"/"Ontem"/data — separador de dia na thread. */
export function rotuloDia(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmoDia(data, hoje)) return "Hoje";
  if (mesmoDia(data, ontem)) return "Ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Hora se for hoje, senao data curta — usado na linha de preview da lista. */
export function formatHoraOuData(iso: string): string {
  const data = new Date(iso);
  if (data.toDateString() === new Date().toDateString()) return formatHora(iso);
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const ROTULO_TIPO: Partial<Record<MensagemTipo, string>> = {
  [MensagemTipo.FOTO]: "📷 Foto",
  [MensagemTipo.AUDIO]: "🎤 Áudio",
  [MensagemTipo.LOCALIZACAO]: "📍 Localização",
  [MensagemTipo.OS_REF]: "📋 Ordem de serviço",
};

/** "Você:" na frente quando a ultima mensagem foi minha — so temos autorNome pra comparar (MensagemResumo nao carrega autorId). */
export function previewMensagem(conversa: ConversaResumo, meuNome: string): string {
  const u = conversa.ultimaMensagem;
  if (!u) return "Nenhuma mensagem ainda";
  if (u.apagadoEm) return "Mensagem apagada";
  const prefixo = u.autorNome === meuNome ? "Você: " : "";
  return `${prefixo}${u.corpo ?? ROTULO_TIPO[u.tipo] ?? ""}`;
}

/** Titulo de exibicao — thread de OS mostra "OS #sgpOsId" mesmo se o servidor mandar outro titulo. */
export function tituloConversa(conversa: ConversaResumo): string {
  return conversa.tipo === ConversaTipo.OS && conversa.sgpOsId ? `OS #${conversa.sgpOsId}` : conversa.titulo;
}

export function tituloPresenca(conversa: ConversaResumo, meuId: string): string {
  if (conversa.tipo !== ConversaTipo.DIRETA) return `${conversa.participantes.length} participantes`;
  const outro = conversa.participantes.find((p) => p.usuarioId !== meuId);
  if (!outro) return "";
  if (outro.online) return "Online";
  if (!outro.ultimaAtividadeEm) return "Offline";
  const min = Math.round((Date.now() - new Date(outro.ultimaAtividadeEm).getTime()) / 60_000);
  if (min < 1) return "Visto agora";
  if (min < 60) return `Visto há ${min}min`;
  return `Visto há ${Math.round(min / 60)}h`;
}
