import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { limparBadge, obterTokenPush, registrarPush, rotaDoPush } from "@/lib/push";

/**
 * Liga o push ao ciclo de vida do app: registra o aparelho quando ha sessao e
 * leva pra tela certa quando o tecnico toca no aviso.
 *
 * Montar UMA vez, no layout de dentro da sessao.
 *
 * `aoTocar`: quem esta no painel (WebView) navega la dentro em vez de ir pra
 * uma tela nativa. Sem ele, vale a rota nativa do tecnico (rotaDoPush).
 */
export function usePush(aoTocar?: (dados: unknown) => void) {
  const { token } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const jaRegistrou = useRef(false);
  // Ref: trocar o callback a cada render nao pode re-registrar os listeners.
  const aoTocarRef = useRef(aoTocar);
  aoTocarRef.current = aoTocar;

  // Registro: uma vez por sessao. A API e idempotente, mas repetir a cada
  // render seria uma escrita no banco por render.
  useEffect(() => {
    if (!token || jaRegistrou.current || Platform.OS === "web") return;
    jaRegistrou.current = true;
    void (async () => {
      const expoToken = await obterTokenPush();
      await registrarPush(expoToken, token);
    })();
  }, [token]);

  // Sessao encerrada: permite registrar de novo no proximo login (aparelho
  // compartilhado troca de dono).
  useEffect(() => {
    if (!token) jaRegistrou.current = false;
  }, [token]);

  useEffect(() => {
    // Na web (expo start --web, usado pra revisar telas) a API de avisos nao
    // existe e o getLastNotificationResponse derrubava o app inteiro.
    if (!token || Platform.OS === "web") return;

    // Aviso recebido com o app ABERTO: nao navega (seria sequestrar a tela de
    // quem esta no meio de uma OS), so invalida as queries pra lista/thread
    // atualizarem sozinhas.
    const aoReceber = Notifications.addNotificationReceivedListener(() => {
      qc.invalidateQueries({ queryKey: ["chat"] });
      qc.invalidateQueries({ queryKey: ["conversas-cliente"] });
      qc.invalidateQueries({ queryKey: ["fila"] });
    });

    const navegar = (dados: unknown) => {
      if (aoTocarRef.current) return aoTocarRef.current(dados);
      const rota = rotaDoPush(dados);
      if (rota) router.push(rota as never);
    };

    // Toque no aviso: aqui sim navega — foi o usuario que pediu.
    const aoTocarAviso = Notifications.addNotificationResponseReceivedListener((resposta) => {
      navegar(resposta.notification.request.content.data);
      void limparBadge();
    });

    // App aberto PELO toque (estava fechado): o listener acima nao pega esse
    // caso — o evento aconteceu antes de existir componente pra escutar.
    void Notifications.getLastNotificationResponseAsync().then((resposta) => {
      if (!resposta) return;
      navegar(resposta.notification.request.content.data);
    });

    return () => {
      aoReceber.remove();
      aoTocarAviso.remove();
    };
  }, [token, router, qc]);
}
