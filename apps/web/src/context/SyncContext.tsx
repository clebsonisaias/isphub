import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { syncEngine, type ConexaoStatus } from "@/lib/syncEngine";

interface SyncContextValue {
  status: ConexaoStatus;
  pendencias: number;
  sincronizarAgora: () => Promise<{ sincronizados: number; falhas: number }>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConexaoStatus>("online");
  const [pendencias, setPendencias] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe((novoStatus, novasPendencias) => {
      setStatus(novoStatus);
      setPendencias(novasPendencias);
    });
    return unsubscribe;
  }, []);

  const sincronizarAgora = () => syncEngine.sincronizar();

  return (
    <SyncContext.Provider value={{ status, pendencias, sincronizarAgora }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync deve ser usado dentro de um SyncProvider");
  }
  return context;
}
