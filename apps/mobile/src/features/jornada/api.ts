import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JornadaResposta, MotivoPausa, OrigemOcupacao, PapelOcupacao } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { obterGeoOuNada } from "@/features/localizacao";
import type { EscolhaViatura } from "./viatura";

/** A ocupacao aberta do proprio tecnico, como `GET /frota/minha-viatura` devolve. */
export interface OcupacaoAtual {
  id: string;
  veiculoId: string;
  veiculoPlaca: string;
  veiculoModelo: string;
  usuarioId: string;
  usuarioNome: string;
  papel: PapelOcupacao;
  origem: OrigemOcupacao;
  declaradoPorNome: string;
  inicioEm: string;
  fimEm: string | null;
  odometroInicio: number | null;
  odometroFim: number | null;
}

/**
 * `JornadaResposta` + os campos que a rota acrescenta quando ha viatura.
 *
 * A resposta do servidor cresceu ADITIVAMENTE: quem nao conhece `ocupacao` e
 * `avisos` continua funcionando. Aqui a gente passa a conhecer.
 */
interface RespostaComViatura extends JornadaResposta {
  ocupacao?: OcupacaoAtual | null;
  avisos?: { codigo: string; mensagem: string; usuarioId: string }[];
}

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

  /*
   * A ocupacao mudou: quem esta em cada viatura tambem mudou. Sem invalidar,
   * a folha reabriria mostrando o carro como "livre" logo depois de a pessoa
   * ter entrado nele.
   */
  const aoMudarComViatura = (r: RespostaComViatura) => {
    aoMudar();
    qc.invalidateQueries({ queryKey: ["frota"] });
    /*
     * Aviso do SERVIDOR, mostrado como veio. O texto ja e escrito pra quem le
     * na rua ("Fulano já estava em outra viatura…"), e reescreve-lo aqui
     * criaria duas versoes da mesma explicacao.
     */
    for (const a of r.avisos ?? []) Alert.alert("Viatura", a.mensagem);
  };

  const iniciar = useMutation({
    mutationFn: async (viatura?: EscolhaViatura) => {
      const geo = await obterGeoOuNada();
      return apiFetch<RespostaComViatura>("/jornada/iniciar", {
        method: "POST",
        token,
        body: { ...(geo ?? {}), ...(viatura ?? {}) },
      });
    },
    onSuccess: aoMudarComViatura,
    onError: avisarFalha("iniciar a jornada"),
  });

  /**
   * Trocar de viatura no MEIO do turno — sem encerrar a jornada.
   *
   * O caso real: o tecnico sai de manha na HFX-3652, o carro quebra, e as 13:30
   * ele segue na NOC-4D34. Sem esta acao a unica saida seria encerrar e reabrir
   * o turno, o que partiria a jornada em duas e estragaria o "tempo trabalhado".
   */
  const trocarViatura = useMutation({
    mutationFn: async (viatura: EscolhaViatura) => {
      const geo = await obterGeoOuNada();
      return apiFetch<RespostaComViatura>("/jornada/veiculo", {
        method: "PATCH",
        token,
        body: { ...(geo ?? {}), ...viatura },
      });
    },
    onSuccess: aoMudarComViatura,
    onError: avisarFalha("trocar de viatura"),
  });

  const encerrar = useMutation({
    mutationFn: async () => {
      const geo = await obterGeoOuNada();
      return apiFetch<JornadaResposta>("/jornada/encerrar", { method: "POST", token, body: geo ?? {} });
    },
    onSuccess: aoMudar,
    onError: avisarFalha("encerrar a jornada"),
  });

  /*
   * Pausar nao pede geo. Iniciar e encerrar carimbam onde o tecnico estava
   * porque aquilo delimita o turno; o almoco nao — perguntar a localizacao de
   * alguem toda vez que ele para pra comer e vigilancia, nao operacao.
   */
  const pausar = useMutation({
    mutationFn: async (motivo: MotivoPausa = "almoco") =>
      apiFetch<JornadaResposta>("/jornada/pausar", { method: "POST", token, body: { motivo } }),
    onSuccess: aoMudar,
    onError: avisarFalha("pausar a jornada"),
  });

  const retomar = useMutation({
    mutationFn: async () => apiFetch<JornadaResposta>("/jornada/retomar", { method: "POST", token, body: {} }),
    onSuccess: aoMudar,
    onError: avisarFalha("retomar a jornada"),
  });

  return { query, iniciar, encerrar, trocarViatura, pausar, retomar };
}

/**
 * A viatura em que EU estou agora.
 *
 * `GET /frota/minha-viatura` e `requireAuth` puro, sem papel — existe
 * exatamente pra isto. O tecnico ve a PROPRIA viatura; `/frota/mapa` (a frota
 * inteira) continua ADMIN/GESTOR.
 */
export function useMinhaViatura() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["frota", "minha-viatura"],
    enabled: !!token,
    queryFn: () => apiFetch<OcupacaoAtual | null>("/frota/minha-viatura", { token }),
  });
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
