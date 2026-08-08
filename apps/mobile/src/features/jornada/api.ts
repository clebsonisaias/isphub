import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JornadaResposta } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { obterLocalizacaoAtual } from "@/features/chat/media";

/**
 * Jornada do tecnico — iniciar/encerrar o turno.
 *
 * Segue o padrao de `features/minhas-os/acoes.ts`: mutation + invalidacao +
 * `Alert` no erro. Falha muda aqui seria pior que na OS: o tecnico tocaria
 * "Iniciar", a tela nao mudaria, e ele passaria o dia achando que bateu o
 * inicio.
 */

function avisarFalha(acao: string) {
  return (erro: unknown) => {
    const detalhe = erro instanceof Error ? erro.message : "Verifique a conexão e tente de novo.";
    Alert.alert(`Não foi possível ${acao}`, detalhe);
  };
}

/**
 * Pega a posicao SEM travar a acao.
 *
 * Localizacao aqui e complemento — se a permissao estiver negada ou o GPS
 * demorar, o turno comeca do mesmo jeito. Bloquear o inicio do dia de trabalho
 * por causa de um dado acessorio seria trocar o principal pelo secundario.
 */
async function geoOuNada(): Promise<{ lat: number; lng: number } | null> {
  try {
    return await obterLocalizacaoAtual();
  } catch {
    return null;
  }
}

export function useJornada() {
  const { token, refetchMe } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["jornada"],
    enabled: !!token,
    queryFn: () => apiFetch<JornadaResposta>("/jornada/atual", { token }),
    /*
     * O cronometro anda sozinho a partir de `inicioEm` + offset do servidor —
     * nao precisa refazer a consulta pra contar o tempo. Isto aqui so pega
     * mudanca vinda de FORA (outro aparelho, ou o gestor mexendo).
     */
    refetchInterval: 5 * 60_000,
  });

  /*
   * Iniciar/encerrar mexe TAMBEM no status do perfil (Disponivel/Indisponivel),
   * na mesma transacao do servidor. Sem o `refetchMe` a tela de perfil ficaria
   * mostrando o status antigo — o usuario nao e uma query do TanStack, mora no
   * contexto de auth.
   */
  const aoMudar = () => {
    qc.invalidateQueries({ queryKey: ["jornada"] });
    void refetchMe();
  };

  const iniciar = useMutation({
    mutationFn: async () => {
      const geo = await geoOuNada();
      return apiFetch<JornadaResposta>("/jornada/iniciar", { method: "POST", token, body: geo ?? {} });
    },
    onSuccess: aoMudar,
    onError: avisarFalha("iniciar a jornada"),
  });

  const encerrar = useMutation({
    mutationFn: async () => {
      const geo = await geoOuNada();
      return apiFetch<JornadaResposta>("/jornada/encerrar", { method: "POST", token, body: geo ?? {} });
    },
    onSuccess: aoMudar,
    onError: avisarFalha("encerrar a jornada"),
  });

  return { query, iniciar, encerrar };
}

/**
 * Relogio do SERVIDOR, derivado de `agoraServidor`.
 *
 * O cronometro e `agora - inicioEm`, e `inicioEm` foi carimbado pelo servidor.
 * Medir com o relogio do APARELHO faria um celular desacertado mostrar um
 * "tempo trabalhado" errado — justamente o numero que o tecnico confere. O
 * offset resolve: mesmo padrao do `HeaderClock` do painel web.
 *
 * Tick de 30s, nao 1s: o mostrador e "5h58", entao segundo nao aparece. A cada
 * segundo seria bateria queimada por nada num aparelho que passa o dia fora da
 * tomada — e a defasagem maxima de 30s some num numero em minutos.
 */
export function useRelogioServidor(agoraServidor: string | undefined): Date {
  const offset = useRef(0);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    if (!agoraServidor) return;
    const t = Date.parse(agoraServidor);
    if (Number.isNaN(t)) return;
    /*
     * A latencia da resposta entra no offset (o servidor mandou a hora um RTT
     * atras). Num cronometro de turno, exibido em minutos, isso e irrelevante —
     * e corrigir exigiria medir ida e volta, complexidade sem retorno aqui.
     */
    offset.current = t - Date.now();
    setAgora(new Date(Date.now() + offset.current));
  }, [agoraServidor]);

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date(Date.now() + offset.current)), 30_000);
    return () => clearInterval(id);
  }, []);

  return agora;
}
