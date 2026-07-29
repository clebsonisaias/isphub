import { useEffect, useRef } from "react";
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
 */
export function usePush() {
  const { token } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const jaRegistrou = useRef(false);

  // Registro: uma vez por sessao. A API e idempotente, mas repetir a cada
  // render seria uma escrita no banco por render.
  useEffect(() => {
    if (!token || jaRegistrou.current) return;
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
    if (!token) return;

    // Aviso recebido com o app ABERTO: nao navega (seria sequestrar a tela de
    // quem esta no meio de uma OS), so invalida as queries pra lista/thread
    // atualizarem sozinhas.
    const aoReceber = Notifications.addNotificationReceivedListener(() => {
      qc.invalidateQueries({ queryKey: ["chat"] });
      qc.invalidateQueries({ queryKey: ["conversas-cliente"] });
      qc.invalidateQueries({ queryKey: ["fila"] });
    });

    // Toque no aviso: aqui sim navega — foi o usuario que pediu.
    const aoTocar = Notifications.addNotificationResponseReceivedListener((resposta) => {
      const rota = rotaDoPush(resposta.notification.request.content.data);
      if (rota) router.push(rota as never);
      void limparBadge();
    });

    // App aberto PELO toque (estava fechado): o listener acima nao pega esse
    // caso — o evento aconteceu antes de existir componente pra escutar.
    void Notifications.getLastNotificationResponseAsync().then((resposta) => {
      if (!resposta) return;
      const rota = rotaDoPush(resposta.notification.request.content.data);
      if (rota) router.push(rota as never);
    });

    return () => {
      aoReceber.remove();
      aoTocar.remove();
    };
  }, [token, router, qc]);
}
