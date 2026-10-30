import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { FilaItem, OsStatus } from "@isphub/shared";
import type { ImagemComprimida } from "@/lib/imagem";

export interface OutboxMutation {
  id: string;
  ordemServicoId: string;
  tipo: "A_CAMINHO" | "STATUS" | "ANOTACAO" | "FOTO";
  payload: {
    status?: OsStatus;
    texto?: string;
    fotoIdLocal?: string;
  };
  criadoEm: number;
  status: "PENDENTE" | "ENVIANDO" | "ERRO";
  tentativas: number;
  ultimoErro?: string;
}

export interface OfflineBlobItem {
  id: string;
  ordemServicoId: string;
  imagem: ImagemComprimida;
  legenda?: string;
  criadoEm: number;
}

interface IsphubOfflineDB extends DBSchema {
  os_cache: {
    key: string;
    value: FilaItem;
  };
  outbox_mutations: {
    key: string;
    value: OutboxMutation;
    indexes: {
      por_criado: number;
      por_status: string;
    };
  };
  blob_store: {
    key: string;
    value: OfflineBlobItem;
    indexes: {
      por_os: string;
    };
  };
}

const DB_NAME = "isphub_offline_db";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<IsphubOfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<IsphubOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<IsphubOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("os_cache")) {
          db.createObjectStore("os_cache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("outbox_mutations")) {
          const store = db.createObjectStore("outbox_mutations", { keyPath: "id" });
          store.createIndex("por_criado", "criadoEm");
          store.createIndex("por_status", "status");
        }
        if (!db.objectStoreNames.contains("blob_store")) {
          const store = db.createObjectStore("blob_store", { keyPath: "id" });
          store.createIndex("por_os", "ordemServicoId");
        }
      },
    });
  }
  return dbPromise;
}

export const offlineStorage = {
  // --- OS CACHE ---
  async salvarOs(itens: FilaItem | FilaItem[]): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction("os_cache", "readwrite");
      const store = tx.objectStore("os_cache");
      const lista = Array.isArray(itens) ? itens : [itens];
      for (const item of lista) {
        await store.put(item);
      }
      await tx.done;
    } catch (e) {
      console.warn("[offlineStorage] Erro ao salvar OS no cache:", e);
    }
  },

  async obterOs(id: string): Promise<FilaItem | undefined> {
    try {
      const db = await getDB();
      return await db.get("os_cache", id);
    } catch {
      return undefined;
    }
  },

  async listarOs(): Promise<FilaItem[]> {
    try {
      const db = await getDB();
      return await db.getAll("os_cache");
    } catch {
      return [];
    }
  },

  // --- OUTBOX MUTATIONS ---
  async enfileirarMutacao(
    dados: Omit<OutboxMutation, "id" | "criadoEm" | "status" | "tentativas">,
  ): Promise<OutboxMutation> {
    const db = await getDB();
    const mutacao: OutboxMutation = {
      id: crypto.randomUUID(),
      ...dados,
      criadoEm: Date.now(),
      status: "PENDENTE",
      tentativas: 0,
    };
    await db.put("outbox_mutations", mutacao);

    // Atualiza otimisticamente a OS em cache se for alteração de status
    if (mutacao.tipo === "A_CAMINHO" || (mutacao.tipo === "STATUS" && mutacao.payload.status)) {
      const osExistente = await db.get("os_cache", mutacao.ordemServicoId);
      if (osExistente) {
        const novoStatus = mutacao.tipo === "A_CAMINHO" ? ("em_deslocamento" as OsStatus) : mutacao.payload.status!;
        osExistente.status = novoStatus;
        await db.put("os_cache", osExistente);
      }
    } else if (mutacao.tipo === "ANOTACAO" && mutacao.payload.texto) {
      const osExistente = await db.get("os_cache", mutacao.ordemServicoId);
      if (osExistente) {
        osExistente.observacao = mutacao.payload.texto;
        await db.put("os_cache", osExistente);
      }
    }

    return mutacao;
  },

  async listarOutbox(): Promise<OutboxMutation[]> {
    try {
      const db = await getDB();
      const all = await db.getAllFromIndex("outbox_mutations", "por_criado");
      return all;
    } catch {
      return [];
    }
  },

  async atualizarStatusMutacao(id: string, status: "PENDENTE" | "ENVIANDO" | "ERRO", erro?: string): Promise<void> {
    try {
      const db = await getDB();
      const item = await db.get("outbox_mutations", id);
      if (item) {
        item.status = status;
        item.tentativas += 1;
        if (erro) item.ultimoErro = erro;
        await db.put("outbox_mutations", item);
      }
    } catch (e) {
      console.warn("[offlineStorage] Erro ao atualizar status da mutação:", e);
    }
  },

  async removerMutacao(id: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete("outbox_mutations", id);
    } catch (e) {
      console.warn("[offlineStorage] Erro ao remover mutação:", e);
    }
  },

  async contarPendencias(): Promise<number> {
    try {
      const db = await getDB();
      return await db.count("outbox_mutations");
    } catch {
      return 0;
    }
  },

  // --- BLOBS DE FOTOS ---
  async salvarBlob(id: string, ordemServicoId: string, imagem: ImagemComprimida, legenda?: string): Promise<void> {
    try {
      const db = await getDB();
      await db.put("blob_store", {
        id,
        ordemServicoId,
        imagem,
        legenda,
        criadoEm: Date.now(),
      });
    } catch (e) {
      console.warn("[offlineStorage] Erro ao salvar foto no blob_store:", e);
    }
  },

  async obterBlob(id: string): Promise<OfflineBlobItem | undefined> {
    try {
      const db = await getDB();
      return await db.get("blob_store", id);
    } catch {
      return undefined;
    }
  },

  async removerBlob(id: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete("blob_store", id);
    } catch (e) {
      console.warn("[offlineStorage] Erro ao remover foto do blob_store:", e);
    }
  },

  async listarBlobsDaOs(ordemServicoId: string): Promise<OfflineBlobItem[]> {
    try {
      const db = await getDB();
      const todos = await db.getAllFromIndex("blob_store", "por_os", ordemServicoId);
      return todos;
    } catch {
      return [];
    }
  },
};
