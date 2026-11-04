function resolveApiUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (typeof window !== "undefined") {
    const { hostname, protocol, port } = window.location;
    const isCapacitor =
      protocol === "capacitor:" ||
      Boolean((window as unknown as { Capacitor?: unknown }).Capacitor) ||
      ((hostname === "localhost" || hostname === "127.0.0.1") && !port);
    const isLocalDev = (hostname === "localhost" || hostname === "127.0.0.1") && !isCapacitor;
    if (!isLocalDev) {
      if (envUrl && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1")) {
        return envUrl;
      }
      return "https://api.isphub.net.br";
    }
  }
  return envUrl || "http://localhost:4000";
}

export const API_URL = resolveApiUrl();
const TOKEN_STORAGE_KEY = "isphub_token";
const REFRESH_STORAGE_KEY = "isphub_refresh";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
        ? localStorage.getItem(key)
        : null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
        localStorage.setItem(key, value);
      }
    } catch {}
  },
  removeItem: (key: string): void => {
    try {
      if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
        localStorage.removeItem(key);
      }
    } catch {}
  },
};

let token: string | null = safeStorage.getItem(TOKEN_STORAGE_KEY);
let refreshToken: string | null = safeStorage.getItem(REFRESH_STORAGE_KEY);

/** Chamado pelo AuthContext ao logar/deslogar; persiste entre recarregamentos. */
export function setAuthToken(newToken: string | null) {
  token = newToken;
  if (newToken) safeStorage.setItem(TOKEN_STORAGE_KEY, newToken);
  else safeStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function setRefreshToken(novo: string | null) {
  refreshToken = novo;
  if (novo) safeStorage.setItem(REFRESH_STORAGE_KEY, novo);
  else safeStorage.removeItem(REFRESH_STORAGE_KEY);
}

export function getAuthToken(): string | null {
  return token;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/**
 * Avisa a aplicacao que a sessao acabou de verdade (renovacao recusada).
 * O AuthContext assina isto pra limpar o usuario e mandar pro login — o
 * apiClient nao conhece React nem rotas, e nao deveria.
 */
type AoPerderSessao = () => void;
let aoPerderSessao: AoPerderSessao | null = null;
export function registrarPerdaDeSessao(cb: AoPerderSessao | null) {
  aoPerderSessao = cb;
}

/**
 * RENOVACAO SILENCIOSA.
 *
 * Uma renovacao por vez, compartilhada: quando a tela dispara varias chamadas
 * juntas (o Painel faz isso no boot) e o access token acabou de vencer, TODAS
 * tomam 401 ao mesmo tempo. Sem esta promessa unica, cada uma dispararia sua
 * propria rotacao — e como o refresh e rotativo, a segunda apresentaria um
 * token que a primeira acabou de queimar. O servidor tem uma janela de graca
 * pra isso, mas gastar a janela por descuido do cliente seria pedir problema.
 */
type Renovacao = "renovou" | "recusou" | "rede";
let renovacaoEmCurso: Promise<Renovacao> | null = null;

async function renovarSessao(): Promise<Renovacao> {
  if (renovacaoEmCurso) return renovacaoEmCurso;

  renovacaoEmCurso = (async (): Promise<Renovacao> => {
    const atual = refreshToken;
    if (!atual) return "recusou";
    try {
      // fetch direto, NAO `request()`: passar por ele criaria recursao —
      // um 401 aqui tentaria renovar de novo, indefinidamente.
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: atual }),
      });
      if (!res.ok) return "recusou";

      const data = (await res.json()) as { token: string; refreshToken: string };
      setAuthToken(data.token);
      setRefreshToken(data.refreshToken);
      return "renovou";
    } catch {
      // Falha de REDE nao e sessao invalida: a chamada original propaga o
      // 401 dela e a sessao fica guardada pra proxima tentativa.
      return "rede";
    }
  })();

  try {
    return await renovacaoEmCurso;
  } finally {
    renovacaoEmCurso = null;
  }
}

function encerrarSessao() {
  setAuthToken(null);
  setRefreshToken(null);
  aoPerderSessao?.();
}

async function enviar(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await enviar(method, path, body);

  /*
   * 401 com refresh disponivel: renova UMA vez e repete. Se a renovacao falhar,
   * a sessao acabou mesmo — limpa e avisa a aplicacao.
   *
   * A rota de refresh nunca entra aqui (ela usa fetch direto), e as rotas
   * publicas de recuperacao de senha tambem nao teriam o que renovar.
   */
  if (res.status === 401 && refreshToken) {
    const renovacao = await renovarSessao();
    if (renovacao === "renovou") res = await enviar(method, path, body);
    else if (renovacao === "recusou") encerrarSessao();
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = (data && (data.error as string)) || `Erro ${res.status}`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

/** Busca um recurso binario (ex.: foto de evidencia) autenticado — <img src> nao manda Authorization. */
async function getBlob(path: string): Promise<Blob> {
  const buscar = async () => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${API_URL}${path}`, { headers });
  };

  let res = await buscar();
  if (res.status === 401 && refreshToken) {
    const renovacao = await renovarSessao();
    if (renovacao === "renovou") res = await buscar();
    else if (renovacao === "recusou") encerrarSessao();
  }
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  getBlob,
  /** Exposto pro SSE, que abre a conexao por fora do `request()`. */
  renovarSessao,
};
