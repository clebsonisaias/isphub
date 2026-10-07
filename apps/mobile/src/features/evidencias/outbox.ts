import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { enviarEvidencia } from "./api";
import type { EvidenciaInput, EvidenciaMime } from "./limites";

/**
 * Fila offline de fotos de evidencia.
 *
 * O indice (metadados) fica no AsyncStorage; o base64 de cada foto fica num
 * ARQUIVO proprio em documentDirectory. Antes tudo ia numa chave so: 3 fotos
 * de ~2 MB passavam do limite do SQLite do Android e a leitura falhava — e o
 * `catch` devolvia fila vazia, ou seja, as fotos sumiam em silencio.
 *
 * Falha de envio NAO descarta: rede/5xx/401 voltam pra fila com backoff;
 * so recusa definitiva do servidor (4xx) marca `falhou`, e ai a tela oferece
 * "tentar de novo".
 */
export interface EvidenciaPendente {
  localId: string;
  osId: string;
  mimeType: EvidenciaMime;
  legenda?: string;
  criadoEm: string;
  /** Servidor recusou (4xx). So sai daqui por `tentarDeNovo`. */
  falhou: boolean;
  tentativas: number;
  /** ISO; antes disso o processador pula o item (backoff). */
  proximaEm?: string;
  /** Formato antigo: base64 inline. Lido uma vez e migrado pra arquivo no envio. */
  input?: EvidenciaInput;
}

const CHAVE = "isphub_evidencias_outbox";
const PASTA = `${FileSystem.documentDirectory ?? ""}evidencias-outbox/`;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

async function lerFila(): Promise<EvidenciaPendente[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as EvidenciaPendente[]) : [];
  } catch {
    return [];
  }
}

async function salvarFila(fila: EvidenciaPendente[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE, JSON.stringify(fila));
}

// Gravado DECODIFICADO (bytes da imagem, nao texto base64): assim a galeria
// aponta <Image> direto pro file:// sem carregar 2 MB de string na memoria.
const EXT: Record<EvidenciaMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const arquivoDe = (localId: string, mime: EvidenciaMime) => `${PASTA}${localId}.${EXT[mime]}`;
const B64 = { encoding: FileSystem.EncodingType.Base64 };

async function gravarDados(localId: string, input: EvidenciaInput): Promise<void> {
  await FileSystem.makeDirectoryAsync(PASTA, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(arquivoDe(localId, input.mimeType), input.dados, B64);
}

async function lerDados(p: EvidenciaPendente): Promise<string> {
  if (p.input) return p.input.dados;
  return FileSystem.readAsStringAsync(arquivoDe(p.localId, p.mimeType), B64);
}

/** URI pra <Image> da foto pendente: file:// (ou data: no formato antigo). */
export function uriDaPendente(p: EvidenciaPendente): string {
  if (p.input) return `data:${p.input.mimeType};base64,${p.input.dados}`;
  return arquivoDe(p.localId, p.mimeType);
}

async function apagarDados(p: Pick<EvidenciaPendente, "localId" | "mimeType">): Promise<void> {
  await FileSystem.deleteAsync(arquivoDe(p.localId, p.mimeType), { idempotent: true }).catch(() => {});
}

/** Lanca se nao conseguir guardar: a tela avisa na hora, em vez de "sumir depois". */
export async function enfileirarEvidencia(osId: string, input: EvidenciaInput): Promise<EvidenciaPendente> {
  const localId = `pendente-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await gravarDados(localId, input);
  const pendente: EvidenciaPendente = {
    localId,
    osId,
    mimeType: input.mimeType,
    legenda: input.legenda,
    criadoEm: new Date().toISOString(),
    falhou: false,
    tentativas: 0,
  };
  const fila = await lerFila();
  fila.push(pendente);
  try {
    await salvarFila(fila);
  } catch (e) {
    await apagarDados(pendente);
    throw e;
  }
  return pendente;
}

export async function listarPendentesDaOs(osId: string): Promise<EvidenciaPendente[]> {
  return (await lerFila()).filter((p) => p.osId === osId);
}

async function atualizar(localId: string, mudanca: (p: EvidenciaPendente) => EvidenciaPendente): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.map((p) => (p.localId === localId ? mudanca(p) : p)));
}

async function removerPendente(localId: string): Promise<void> {
  const fila = await lerFila();
  const alvo = fila.find((p) => p.localId === localId);
  await salvarFila(fila.filter((p) => p.localId !== localId));
  if (alvo) await apagarDados(alvo);
}

export function backoffMs(tentativas: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, tentativas - 1), BACKOFF_MAX_MS);
}

/** 4xx e "nao adianta repetir" — menos 401 (token vencido), 408 e 429. */
export function recusaDefinitiva(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status);
}

async function registrarFalha(localId: string, err: unknown): Promise<void> {
  const agora = Date.now();
  await atualizar(localId, (p) => {
    const tentativas = (p.tentativas ?? 0) + 1;
    return recusaDefinitiva(err)
      ? { ...p, tentativas, falhou: true, proximaEm: undefined }
      : { ...p, tentativas, falhou: false, proximaEm: new Date(agora + backoffMs(tentativas)).toISOString() };
  });
}

/** Volta um item `falhou` pra fila e dispara o envio. */
export async function tentarDeNovo(localId: string): Promise<void> {
  await atualizar(localId, (p) => ({ ...p, falhou: false, tentativas: 0, proximaEm: undefined }));
  await dispararProcessamento();
}

/** Expostos so pro teste — a tela nunca chama estes diretamente. */
export const removerPendenteParaTeste = removerPendente;
export const registrarFalhaParaTeste = registrarFalha;

const elegivel = (p: EvidenciaPendente, agora: number) =>
  !p.falhou && (!p.proximaEm || Date.parse(p.proximaEm) <= agora);

// Uma execucao por vez: o mount e o evento do NetInfo disparavam juntos e
// liam a mesma fila — a mesma foto subia duas vezes.
let emCurso: Promise<void> | null = null;

export function processarFila(token: string, qc?: Pick<QueryClient, "invalidateQueries">): Promise<void> {
  if (emCurso) return emCurso;
  emCurso = (async () => {
    const agora = Date.now();
    for (const pendente of (await lerFila()).filter((p) => elegivel(p, agora))) {
      try {
        const dados = await lerDados(pendente);
        await enviarEvidencia(pendente.osId, token, { dados, mimeType: pendente.mimeType, legenda: pendente.legenda });
        await removerPendente(pendente.localId);
        qc?.invalidateQueries({ queryKey: ["evidencias", pendente.osId] });
      } catch (err) {
        await registrarFalha(pendente.localId, err);
      }
    }
  })().finally(() => {
    emCurso = null;
  });
  return emCurso;
}

// Ponte pra `tentarDeNovo` (chamado da tela) alcancar o processador montado
// no layout, que e quem tem token e QueryClient.
let processadorAtual: (() => Promise<void>) | null = null;
export async function dispararProcessamento(): Promise<void> {
  await processadorAtual?.();
}

/**
 * Montar UMA vez, no layout autenticado: sobe a fila ao abrir o app, quando a
 * rede volta e a cada minuto (pra vencer o backoff) — independente de qual OS
 * o tecnico esta olhando.
 */
export function useProcessarFilaEvidencias(): void {
  const { token } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let ultimaConectividade: boolean | null = null;
    const processar = () => processarFila(token, qc);
    processadorAtual = processar;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const conectado = !!state.isConnected && state.isInternetReachable !== false;
      if (conectado && ultimaConectividade === false) void processar();
      ultimaConectividade = conectado;
    });
    const timer = setInterval(() => void processar(), 60_000);

    void processar();

    return () => {
      unsubscribe();
      clearInterval(timer);
      if (processadorAtual === processar) processadorAtual = null;
    };
  }, [token, qc]);
}
