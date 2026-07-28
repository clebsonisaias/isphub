import type { Response } from "express";
import type { RealtimeEvento } from "@isphub/shared";

/**
 * Hub SSE em memoria, escopado por usuario. Um processo Node + dezenas de
 * tecnicos -> um Map basta. Se escalar horizontal, trocar por Redis pub-sub
 * sem mexer no contrato do evento (ver plano, risco 3).
 *
 * Best-effort: o SSE so REDUZ latencia. Se cair, o polling do app (React Query)
 * cobre — por isso nao guardamos fila de eventos perdidos.
 */
const conexoes = new Map<string, Set<Response>>();

/**
 * Teto de conexoes SSE simultaneas por usuario. Um humano precisa de uma por
 * aba/aparelho; mais que isso e cliente com bug de reconexao ou abuso. Sem
 * teto, um unico token valido abre milhares de streams — cada uma com socket,
 * fd e um timer de keep-alive vivos — ate degradar o processo inteiro (o hub e
 * em memoria, num processo so). Ao estourar, derruba a MAIS ANTIGA: quem
 * acabou de abrir o app e quem esta olhando pra tela.
 */
const MAX_CONEXOES_POR_USUARIO = 5;

/** Registra uma conexao SSE de um usuario; devolve a funcao de remocao (no close). */
export function registrarConexao(userId: string, res: Response): () => void {
  let set = conexoes.get(userId);
  if (!set) {
    set = new Set();
    conexoes.set(userId, set);
  }

  while (set.size >= MAX_CONEXOES_POR_USUARIO) {
    // Set preserva ordem de insercao — o primeiro e o mais antigo.
    const maisAntiga = set.values().next().value;
    if (!maisAntiga) break;
    set.delete(maisAntiga);
    try {
      maisAntiga.end();
    } catch {
      // ja morta — o handler de close limpa o resto
    }
  }

  set.add(res);
  return () => {
    const s = conexoes.get(userId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) conexoes.delete(userId);
  };
}

function escrever(res: Response, evento: RealtimeEvento): void {
  try {
    res.write(`data: ${JSON.stringify(evento)}\n\n`);
  } catch {
    // conexao morta -> o handler de close ja limpa
  }
}

/** Empurra um evento pras conexoes de UM usuario (ex.: o tecnico da OS). */
export function emitParaUsuario(userId: string | null | undefined, evento: RealtimeEvento): void {
  if (!userId) return;
  const set = conexoes.get(userId);
  if (!set) return;
  for (const res of set) escrever(res, evento);
}

/** Empurra um evento pra todas as conexoes abertas (ex.: config-alterada). */
export function emitParaTodos(evento: RealtimeEvento): void {
  for (const set of conexoes.values()) for (const res of set) escrever(res, evento);
}

/** Quantidade de usuarios com conexao ativa — util em teste/observabilidade. */
export function usuariosConectados(): number {
  return conexoes.size;
}

/**
 * Fecha todas as conexoes SSE. Usado no desligamento gracioso: sem isto,
 * `server.close()` espera pra sempre — um stream SSE nunca termina sozinho.
 */
export function fecharTodasConexoes(): void {
  for (const set of conexoes.values()) {
    for (const res of set) {
      try {
        res.end();
      } catch {
        // conexao ja morta
      }
    }
  }
  conexoes.clear();
}
