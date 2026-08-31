import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { enviarEvidencia } from "./api";
import type { EvidenciaInput } from "./limites";

/**
 * Fila offline de fotos de evidencia. Mesmo desenho do outbox do chat
 * (features/chat/outbox.ts), com duas diferencas: agrupa por `osId`, e o item
 * guarda o base64 JA COMPRIMIDO — comprimir ao enfileirar, nao ao enviar, pra
 * fila nao reter o arquivo original inteiro no AsyncStorage.
 *
 * Existe porque tecnico em campo fica sem sinal o tempo todo, e envio direto
 * com erro visivel e, na pratica, foto perdida: ninguem repete depois.
 */
export interface EvidenciaPendente {
  localId: string;
  osId: string;
  input: EvidenciaInput;
  criadoEm: string;
  falhou: boolean;
}

const CHAVE = "isphub_evidencias_outbox";

async function lerFila(): Promise<EvidenciaPendente[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as EvidenciaPendente[]) : [];
  } catch {
    return [];
  }
}

async function salvarFila(fila: EvidenciaPendente[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE, JSON.stringify(fila)).catch(() => {});
}

export async function enfileirarEvidencia(osId: string, input: EvidenciaInput): Promise<EvidenciaPendente> {
  const fila = await lerFila();
  const pendente: EvidenciaPendente = {
    localId: `pendente-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    osId,
    input,
    criadoEm: new Date().toISOString(),
    falhou: false,
  };
  fila.push(pendente);
  await salvarFila(fila);
  return pendente;
}

export async function listarPendentesDaOs(osId: string): Promise<EvidenciaPendente[]> {
  return (await lerFila()).filter((p) => p.osId === osId);
}

async function removerPendente(localId: string): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.filter((p) => p.localId !== localId));
}

async function marcarFalhou(localId: string): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.map((p) => (p.localId === localId ? { ...p, falhou: true } : p)));
}

/** Expostos so pro teste — a tela nunca chama estes diretamente. */
export const removerPendenteParaTeste = removerPendente;
export const marcarFalhouParaTeste = marcarFalhou;

/**
 * Sobe a fila quando a rede volta. Falha marca `falhou` em vez de tentar pra
 * sempre — e o item FICA na fila, porque descartar perderia a foto em silencio.
 */
export function useProcessarFilaEvidencias(): void {
  const { token } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let ultimaConectividade: boolean | null = null;

    async function processar() {
      const fila = await lerFila();
      for (const pendente of fila.filter((p) => !p.falhou)) {
        try {
          await enviarEvidencia(pendente.osId, token, pendente.input);
          await removerPendente(pendente.localId);
          qc.invalidateQueries({ queryKey: ["evidencias", pendente.osId] });
        } catch {
          await marcarFalhou(pendente.localId);
        }
      }
    }

    const unsubscribe = NetInfo.addEventListener((state) => {
      const conectado = !!state.isConnected && state.isInternetReachable !== false;
      if (conectado && ultimaConectividade === false) void processar();
      ultimaConectividade = conectado;
    });

    void processar(); // app reaberto ja online, com fila da sessao anterior

    return () => unsubscribe();
  }, [token, qc]);
}
