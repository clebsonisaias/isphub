/**
 * Semaforo simples (sem dependencia nova) pra limitar quantas chamadas
 * concorrentes cada chave (ex.: um provedor) pode ter em voo ao mesmo tempo.
 * Usado nas consultas ao vivo de conexao/detalhes tecnicos: o Painel pode
 * disparar dezenas de cards pedindo status ao mesmo tempo, e o SGP de um
 * provedor e um sistema externo unico — sem isso, um scroll rapido vira uma
 * rajada de dezenas de requisicoes simultaneas pro mesmo servidor do provedor.
 */
class Semaforo {
  private disponiveis: number;
  private fila: Array<() => void> = [];

  constructor(max: number) {
    this.disponiveis = max;
  }

  async adquirir(): Promise<() => void> {
    if (this.disponiveis > 0) {
      this.disponiveis--;
      return () => this.liberar();
    }
    return new Promise((resolve) => {
      this.fila.push(() => {
        this.disponiveis--;
        resolve(() => this.liberar());
      });
    });
  }

  private liberar() {
    this.disponiveis++;
    const proximo = this.fila.shift();
    if (proximo) proximo();
  }
}

const semaforos = new Map<string, Semaforo>();

/** Roda `fn` respeitando um limite de concorrência por `chave` (ex.: provedorId). */
export async function comConcorrenciaLimitada<T>(chave: string, maxConcorrente: number, fn: () => Promise<T>): Promise<T> {
  let semaforo = semaforos.get(chave);
  if (!semaforo) {
    semaforo = new Semaforo(maxConcorrente);
    semaforos.set(chave, semaforo);
  }
  const liberar = await semaforo.adquirir();
  try {
    return await fn();
  } finally {
    liberar();
  }
}
