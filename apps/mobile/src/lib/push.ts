import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { apiFetch } from "./api";

/**
 * Push (notificacao no aparelho).
 *
 * Irmao do SSE (lib/realtime.tsx): o SSE so vive com o app ABERTO. O tecnico
 * esta dirigindo, de luva, com o celular no bolso — push e o unico canal que
 * chega com o app fechado.
 *
 * FAIL-SAFE, como a biometria: qualquer erro aqui e engolido. Ficar sem
 * notificacao e ruim; nao conseguir entrar no app por causa dela seria pior.
 */

/** Para onde o toque na notificacao leva. Espelha `PushDados` da API. */
export type PushDados =
  | { tela: "chat"; conversaId: string }
  | { tela: "chat-clientes"; conversaId: string }
  | { tela: "os"; osId: string };

/** Canal do Android. Precisa existir ANTES do primeiro push, senao o Android
 * 8+ joga o aviso no canal padrao — sem som e sem vibracao, que na pratica e o
 * mesmo que nao notificar alguem que esta com o celular no bolso. */
const CANAL_ID = "isphub-avisos";

/** Com o app aberto, mostra o aviso mesmo assim (o padrao do Expo e silenciar). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function garantirCanalAndroid() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CANAL_ID, {
    name: "Avisos do ISPhub",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#4F46E5",
    // `sound` aqui e NOME DE ARQUIVO de som customizado, nao o literal
    // "default" — passar "default" fazia o expo-notifications procurar um
    // arquivo com esse nome e reclamar no log a cada abertura. Omitir = som
    // padrao do aparelho, que e o que queremos.
  });
}

/**
 * Pede permissao (se ainda nao tem) e devolve o token do Expo. `null` quando
 * nao da pra notificar: emulador, permissao negada, ou projeto sem credencial.
 */
export async function obterTokenPush(): Promise<string | null> {
  try {
    // Emulador nao recebe push. Sem esta guarda o getExpoPushTokenAsync lanca
    // e polui o log a cada abertura em dev.
    if (!Device.isDevice) return null;

    await garantirCanalAndroid();

    const { status: atual } = await Notifications.getPermissionsAsync();
    let status = atual;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    // O projectId vem do app.json/EAS. Sem ele o Expo nao sabe pra qual
    // projeto emitir o token — e o erro que aparece antes de configurar o EAS.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return data ?? null;
  } catch (err) {
    avisarFalhaToken(err);
    return null;
  }
}

/** Ja avisou nesta sessao? Evita repetir a cada abertura/re-render. */
let jaAvisouFalhaToken = false;

/**
 * "Firebase nao configurado" e um estado ESPERADO enquanto a credencial nao
 * chega — nao e defeito. Como `console.warn` no dev vira caixa amarela por
 * cima do app, esse caso sai como log discreto e UMA vez por sessao; ficar
 * gritando a cada abertura treina a equipe a ignorar aviso de verdade.
 */
function avisarFalhaToken(err: unknown) {
  if (jaAvisouFalhaToken) return;
  jaAvisouFalhaToken = true;
  const msg = err instanceof Error ? err.message : String(err);
  const semCredencial = /FirebaseApp|googleServicesFile|Firebase Messaging|APNS|apns/i.test(msg);
  if (semCredencial) {
    console.log("[push] desligado: falta a credencial do Firebase/APNs (ver docs/push-notificacoes.md). O resto do app segue normal.");
    return;
  }
  console.warn("[push] nao foi possivel obter o token:", err);
}

/**
 * Ultimo token registrado, no escopo do modulo. Existe porque o logout mora no
 * AuthProvider, que nao tem (nem deveria ter) o token do push — e desregistrar
 * DEPOIS de limpar a sessao seria tarde: a chamada precisa do token de auth.
 */
let tokenRegistrado: string | null = null;

/** Registra o aparelho na API. Idempotente — o app chama a cada login/abertura. */
export async function registrarPush(token: string | null, autenticacao: string | null): Promise<string | null> {
  if (!token || !autenticacao) return null;
  try {
    await apiFetch<void>("/notificacoes/push/registrar", {
      method: "POST",
      token: autenticacao,
      body: { token, plataforma: Platform.OS === "ios" ? "ios" : "android" },
    });
    tokenRegistrado = token;
    return token;
  } catch (err) {
    console.warn("[push] falha ao registrar:", err);
    return null;
  }
}

/** Desregistra o aparelho que esta registrado agora. Chamado no logout. */
export async function desregistrarPushAtual(autenticacao: string | null): Promise<void> {
  const token = tokenRegistrado;
  tokenRegistrado = null;
  await desregistrarPush(token, autenticacao);
}

/**
 * Desregistra no logout. Sem isto o proximo dono do aparelho — ou o mesmo
 * tecnico deslogado — continuaria recebendo as conversas da conta anterior.
 */
export async function desregistrarPush(token: string | null, autenticacao: string | null): Promise<void> {
  if (!token || !autenticacao) return;
  try {
    await apiFetch<void>(`/notificacoes/push/${encodeURIComponent(token)}`, {
      method: "DELETE",
      token: autenticacao,
    });
  } catch (err) {
    console.warn("[push] falha ao desregistrar:", err);
  }
}

/** Zera o contador no icone do app. */
export async function limparBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // aparelho/launcher sem suporte a badge — irrelevante
  }
}

/** Traduz o `data` do push na rota do app. `null` = payload desconhecido. */
export function rotaDoPush(dados: unknown): string | null {
  if (!dados || typeof dados !== "object") return null;
  const d = dados as Partial<PushDados & { conversaId: string; osId: string }>;
  switch (d.tela) {
    case "chat":
      return d.conversaId ? `/chat/${d.conversaId}` : "/chat";
    case "chat-clientes":
      return d.conversaId ? `/chat-clientes/${d.conversaId}` : "/chat-clientes";
    case "os":
      return d.osId ? `/minhas-os/${d.osId}` : "/minhas-os";
    default:
      return null;
  }
}
