import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { EnviarMensagemInput } from "./hooks";

/**
 * Fila offline de mensagens — mesmo espirito da fila offline de evidencias
 * (mensagem enviada sem rede fica "pendente" e sobe quando a rede volta).
 * Persistida em AsyncStorage (unica opcao ja usada no app, ver lib/config.tsx)
 * pra sobreviver o app fechar com mensagens ainda por enviar.
 */
export interface MensagemPendente {
  localId: string;
  conversaId: string;
  input: EnviarMensagemInput;
  criadoEm: string;
  falhou: boolean;
}

const CHAVE = "isphub_chat_outbox";

async function lerFila(): Promise<MensagemPendente[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as MensagemPendente[]) : [];
  } catch {
    return [];
  }
}

async function salvarFila(fila: MensagemPendente[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE, JSON.stringify(fila)).catch(() => {});
}

export async function enfileirarMensagemPendente(conversaId: string, input: EnviarMensagemInput): Promise<MensagemPendente> {
  const fila = await lerFila();
  const pendente: MensagemPendente = {
    localId: `pendente-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversaId,
    input,
    criadoEm: new Date().toISOString(),
    falhou: false,
  };
  fila.push(pendente);
  await salvarFila(fila);
  return pendente;
}

export async function listarPendentes(conversaId: string): Promise<MensagemPendente[]> {
  return (await lerFila()).filter((p) => p.conversaId === conversaId);
}

async function removerPendente(localId: string): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.filter((p) => p.localId !== localId));
}

async function marcarFalhou(localId: string): Promise<void> {
  const fila = await lerFila();
  await salvarFila(fila.map((p) => (p.localId === localId ? { ...p, falhou: true } : p)));
}

/**
 * Processa a fila quando a rede volta — uma so vez por mudanca de
 * conectado=false->true, tentando cada mensagem pendente em ordem. Falha de
 * novo (ex.: 403 porque saiu da conversa) marca `falhou` em vez de tentar pra
 * sempre; sucesso invalida as queries da conversa afetada.
 */
export function useProcessarFilaOffline(): void {
  const { token } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let ultimaConectividade: boolean | null = null;

    async function processar() {
      const fila = await lerFila();
      for (const pendente of fila.filter((p) => !p.falhou)) {
        try {
          await apiFetch(`/chat/conversas/${pendente.conversaId}/mensagens`, {
            method: "POST",
            token,
            body: pendente.input,
          });
          await removerPendente(pendente.localId);
          qc.invalidateQueries({ queryKey: ["chat", "mensagens", pendente.conversaId] });
          qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
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

    void processar(); // tambem tenta uma vez ao montar (app reaberto ja online com fila antiga)

    return () => unsubscribe();
  }, [token, qc]);
}
