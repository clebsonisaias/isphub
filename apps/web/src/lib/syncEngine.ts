import { API_URL } from "./apiClient";
import { ordensServicoApi } from "./filaApi";
import { offlineStorage, type OutboxMutation } from "./offlineStorage";

export type ConexaoStatus = "online" | "offline" | "sincronizando";

type Listener = (status: ConexaoStatus, pendencias: number) => void;

class SyncEngine {
  private status: ConexaoStatus = navigator.onLine ? "online" : "offline";
  private pendencias: number = 0;
  private listeners: Set<Listener> = new Set();
  private timerVerificacao: NodeJS.Timeout | null = null;
  private sincronizando: boolean = false;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void this.aoMudarRede());
      window.addEventListener("offline", () => void this.aoMudarRede());

      // Atualiza a contagem inicial de pendências
      void this.atualizarPendencias();

      // Verificação periódica suave (a cada 30 segundos)
      this.timerVerificacao = setInterval(() => {
        void this.verificarConexaoESincronizar();
      }, 30_000);
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.pendencias);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notificar() {
    for (const listener of this.listeners) {
      listener(this.status, this.pendencias);
    }
  }

  public async atualizarPendencias(): Promise<number> {
    this.pendencias = await offlineStorage.contarPendencias();
    this.notificar();
    return this.pendencias;
  }

  public async testarConexaoReal(): Promise<boolean> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return false;
    }
    try {
      const res = await fetch(`${API_URL}/health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async aoMudarRede() {
    const online = await this.testarConexaoReal();
    if (online) {
      this.status = "online";
      void this.sincronizar();
    } else {
      this.status = "offline";
    }
    await this.atualizarPendencias();
  }

  public async verificarConexaoESincronizar() {
    const online = await this.testarConexaoReal();
    if (online) {
      this.status = "online";
      if (this.pendencias > 0) {
        await this.sincronizar();
      }
    } else {
      this.status = "offline";
    }
    await this.atualizarPendencias();
  }

  public async sincronizar(): Promise<{ sincronizados: number; falhas: number }> {
    if (this.sincronizando) return { sincronizados: 0, falhas: 0 };

    const online = await this.testarConexaoReal();
    if (!online) {
      this.status = "offline";
      this.notificar();
      return { sincronizados: 0, falhas: 0 };
    }

    this.sincronizando = true;
    this.status = "sincronizando";
    this.notificar();

    let sincronizados = 0;
    let falhas = 0;

    try {
      const mutacoes = await offlineStorage.listarOutbox();
      for (const mutacao of mutacoes) {
        try {
          await offlineStorage.atualizarStatusMutacao(mutacao.id, "ENVIANDO");
          await this.executarMutacao(mutacao);
          await offlineStorage.removerMutacao(mutacao.id);
          sincronizados++;
          await this.atualizarPendencias();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[SyncEngine] Falha ao sincronizar mutação ${mutacao.id}:`, msg);
          await offlineStorage.atualizarStatusMutacao(mutacao.id, "ERRO", msg);
          falhas++;

          // Se for erro de rede, interrompe o lote para não ficar batendo sem conexão
          const isNetworkError =
            msg.toLowerCase().includes("failed to fetch") ||
            msg.toLowerCase().includes("network") ||
            msg.toLowerCase().includes("timeout");
          if (isNetworkError) {
            this.status = "offline";
            break;
          }
        }
      }
    } finally {
      this.sincronizando = false;
      this.status = (await this.testarConexaoReal()) ? "online" : "offline";
      await this.atualizarPendencias();
    }

    return { sincronizados, falhas };
  }

  private async executarMutacao(mutacao: OutboxMutation): Promise<void> {
    switch (mutacao.tipo) {
      case "A_CAMINHO":
        await ordensServicoApi.aCaminho(mutacao.ordemServicoId);
        break;

      case "STATUS":
        if (mutacao.payload.status) {
          await ordensServicoApi.mudarStatus(mutacao.ordemServicoId, mutacao.payload.status);
        }
        break;

      case "ANOTACAO":
        if (mutacao.payload.texto) {
          await ordensServicoApi.anotar(mutacao.ordemServicoId, mutacao.payload.texto);
        }
        break;

      case "FOTO":
        if (mutacao.payload.fotoIdLocal) {
          const blobItem = await offlineStorage.obterBlob(mutacao.payload.fotoIdLocal);
          if (blobItem) {
            await ordensServicoApi.evidencias.adicionar(
              mutacao.ordemServicoId,
              blobItem.imagem,
              blobItem.legenda,
            );
            await offlineStorage.removerBlob(blobItem.id);
          }
        }
        break;
    }
  }

  public destroy() {
    if (this.timerVerificacao) {
      clearInterval(this.timerVerificacao);
    }
    this.listeners.clear();
  }
}

export const syncEngine = new SyncEngine();
