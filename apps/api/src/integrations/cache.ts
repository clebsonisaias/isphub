interface CacheEntry<T> {
  valor: T;
  expiraEm: number;
}

export class IntegrationCache {
  private mapa = new Map<string, CacheEntry<unknown>>();
  private maxEntradas: number;

  constructor(maxEntradas = 2000) {
    this.maxEntradas = maxEntradas;
  }

  get<T>(chave: string): T | null {
    const entrada = this.mapa.get(chave);
    if (!entrada) return null;

    if (Date.now() > entrada.expiraEm) {
      this.mapa.delete(chave);
      return null;
    }

    return entrada.valor as T;
  }

  set<T>(chave: string, valor: T, ttlMs: number): void {
    if (this.mapa.size >= this.maxEntradas) {
      // Remove o item mais antigo (primeira chave do Map)
      const primeiraChave = this.mapa.keys().next().value;
      if (primeiraChave) {
        this.mapa.delete(primeiraChave);
      }
    }

    this.mapa.set(chave, {
      valor,
      expiraEm: Date.now() + ttlMs,
    });
  }

  delete(chave: string): void {
    this.mapa.delete(chave);
  }

  clear(): void {
    this.mapa.clear();
  }

  size(): number {
    return this.mapa.size;
  }
}

export const integrationCache = new IntegrationCache();
