import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  OsPrioridade,
  OsStatus,
  PAPEL_OCUPACAO_ROTULO,
  filtroDoDia,
  formatarDuracao,
  formatarTrabalhado,
  pausaAberta,
  MOTIVO_PAUSA_LABEL,
  formatarPlaca,
  jornadaPrecisaAtencao,
  type FilaItem,
  type MeuDiaResumo,
} from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch, buildFilaQuery } from "@/lib/api";
import { Card, Hero, Muted, Screen, Segmented } from "@/components/ui";
import {
  Aviso,
  BarraProgresso,
  CardJornada,
  GradeAtalhos,
  Kpi,
  LinhaAgenda,
  ProximaOs,
  Secao,
  type EstadoAgenda,
} from "@/components/painel-dia";
import { colors, font, space } from "@/theme/tokens";
import { Avatar, useAvatarUri } from "@/features/chat/avatar";
import { FilaCard } from "@/features/minhas-os/fila-card";
import { maisRecentesPrimeiro, ordenarPorHorario, ordenarSlaFirst } from "@/features/minhas-os/sla";
import { abrirNoWaze } from "@/features/minhas-os/navegacao";
import { useEscalaDoDia, useJornada, useMinhaViatura, useRelogioServidor } from "@/features/jornada/api";
import { FolhaViatura, type EscolhaViatura } from "@/features/jornada/viatura";
import { FolhaEscolhaAcesso } from "@/features/acesso/folha-escolha";

interface FilaResp {
  itens: FilaItem[];
  total: number;
  truncado: boolean;
}

/**
 * A home do tecnico — "meu dia", nao "minha fila".
 *
 * A tela respondia "o que tem pra mim?" com uma lista. Passa a responder
 * "como esta meu dia e o que eu faco agora?", que e a pergunta de quem esta na
 * rua: a proxima parada primeiro, o rendimento do dia depois, a lista por
 * ultimo. A fila continua ali inteira — so deixou de ser a primeira coisa.
 */
export default function MinhasOs() {
  const { token, usuario, preferencia, definirPreferencia } = useAuth();
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);

  /*
   * DUAS consultas com proposito distinto, de proposito:
   *
   *  - a fila ABERTA e o trabalho que resta (e alimenta a proxima OS);
   *  - a agenda do DIA inclui o que ja foi concluido — sem isso a linha do
   *    tempo comecaria no meio da manha, com as horas ja vencidas em branco.
   */
  const dia = useMemo(() => filtroDoDia(new Date()), []);

  /*
   * Abertas x concluidas. O servidor sempre soube responder `grupo=fechados`
   * (routes/fila.ts), ja escopado ao tecnico — faltava alguem perguntar. Sem
   * isso, OS concluida em qualquer dia que nao fosse HOJE era inalcancavel: o
   * tecnico nao revia a foto que anexou nem a anotacao que escreveu.
   */
  const [grupo, setGrupo] = useState<"abertos" | "fechados">("abertos");

  const fila = useQuery({
    queryKey: ["fila", "minhas-os", grupo],
    enabled: !!token,
    queryFn: () => apiFetch<FilaResp>(`/fila${buildFilaQuery({ equipe: "interna", grupo })}`, { token }),
  });

  const agenda = useQuery({
    queryKey: ["fila", "agenda-dia", dia.de],
    enabled: !!token,
    queryFn: () =>
      apiFetch<FilaResp>(`/fila${buildFilaQuery({ equipe: "interna", de: dia.de, ate: dia.ate })}`, { token }),
  });

  // O resumo vem do servidor porque a fila aberta nao sabe de OS concluida —
  // o app contava so o que enxergava, e concluir uma OS nao mexia no numero.
  const resumo = useQuery({
    queryKey: ["meu-dia"],
    enabled: !!token,
    queryFn: () => apiFetch<MeuDiaResumo>("/dashboard/meu-dia", { token }),
  });

  /*
   * A jornada emoldura o dia: antes de saber qual e a proxima parada, o tecnico
   * precisa saber se ja esta em servico. Por isso o card fica acima de tudo.
   */
  const { query: jornadaQuery, iniciar, encerrar, trocarViatura, pausar, retomar } = useJornada();
  const jornada = jornadaQuery.data?.jornada ?? null;

  /*
   * A folha de viatura serve aos DOIS momentos — abrir o turno e trocar de
   * carro no meio dele. Um estado so, com o modo dentro, em vez de dois
   * booleanos que podem ficar ligados ao mesmo tempo.
   */
  // So "trocar" sobrou: o carro que quebra no meio do dia continua sendo
  // decisao de quem esta na rua.
  const [folha, setFolha] = useState<"trocar" | null>(null);
  const minhaViatura = useMinhaViatura();
  const escala = useEscalaDoDia();
  const rotuloViatura = minhaViatura.data
    ? `${formatarPlaca(minhaViatura.data.veiculoPlaca)} · ${PAPEL_OCUPACAO_ROTULO[minhaViatura.data.papel]}`
    : null;

  function aplicarViatura(escolha?: EscolhaViatura) {
    setFolha(null);
    /*
     * Trocar so faz sentido com jornada aberta; sem ela, "confirmar" e iniciar.
     * Decidir aqui, e nao na folha, mantem a folha burra — ela so devolve a
     * escolha e nao precisa saber em que momento do dia foi aberta.
     */
    if (escolha) trocarViatura.mutate(escolha);
  }
  // Relogio do SERVIDOR: o aparelho pode estar desacertado, e "tempo trabalhado"
  // e justamente o numero que a pessoa confere.
  const agoraServidor = useRelogioServidor(jornadaQuery.data?.agoraServidor);

  /*
   * SLA so ordena o que ainda corre. No arquivo a pergunta e "o que eu fiz por
   * ultimo?", entao vai do mais recente pro mais antigo — o servidor devolve em
   * ordem crescente de agendamento, que aqui seria exatamente o avesso.
   */
  const brutos = fila.data?.itens ?? [];
  const itens = grupo === "abertos" ? ordenarSlaFirst(brutos) : maisRecentesPrimeiro(brutos);
  const fotoUri = useAvatarUri(usuario?.id, usuario?.temFoto, usuario?.fotoVersao);
  const primeiroNome = ((usuario?.nomeExibicao || usuario?.nome) ?? "").trim().split(/\s+/)[0];

  /*
   * A proxima parada e a mais urgente, nao a primeira da agenda: `ordenarSlaFirst`
   * ja poe estourado na frente, e quem esta atrasado nao espera o horario.
   */
  const proxima = itens[0];

  const m = resumo.data;
  const naFila = fila.data?.total ?? itens.length;

  /*
   * "Tempo trabalhado" agora DESCONTA as pausas — antes o almoco contava como
   * trabalho, e o rotulo mentia todo dia na mesma medida.
   */
  const tempoJornada = jornada ? formatarTrabalhado(jornada.inicioEm, jornada.pausas, agoraServidor) : null;
  const pausa = jornada ? pausaAberta(jornada.pausas) : null;

  async function sincronizarERecarregar() {
    setSincronizando(true);
    try {
      // Best-effort: o sync pode estar em rate-limit; as listas recarregam de
      // qualquer jeito pra tela nunca ficar presa num estado velho.
      await apiFetch("/sync/minhas-os", { method: "POST", token }).catch(() => {});
      await Promise.all([fila.refetch(), agenda.refetch(), resumo.refetch()]);
    } finally {
      setSincronizando(false);
    }
  }

  function confirmarEncerrar() {
    // Encerrar e irreversivel pela tela (nao ha "reabrir jornada") e acontece
    // com o celular na mao no fim do dia — merece um passo a mais.
    Alert.alert("Encerrar jornada?", `Você está em serviço há ${tempoJornada ?? "pouco"}.`, [
      { text: "Continuar trabalhando", style: "cancel" },
      { text: "Encerrar", style: "destructive", onPress: () => encerrar.mutate() },
    ]);
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.corpo}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={sincronizarERecarregar} tintColor={colors.brand} />
        }
      >
        <View style={styles.heroWrap}>
          <Hero
            title={`Olá${primeiroNome ? `, ${primeiroNome}` : ""}`}
            subtitle={dataPorExtenso(new Date())}
            right={usuario ? <Avatar nome={usuario.nome} fotoUri={fotoUri} size="lg" /> : undefined}
            style={{ paddingBottom: space.xxl }}
          />
        </View>

        <View style={styles.conteudo}>
          {/* --- O turno: o quadro dentro do qual o dia acontece --- */}
          <CardJornada
            inicio={jornada ? hora(jornada.inicioEm) : null}
            tempo={tempoJornada}
            precisaAtencao={jornada ? jornadaPrecisaAtencao(jornada.inicioEm, agoraServidor) : false}
            temLocalizacao={!!jornada?.latInicio}
            ocupado={
              iniciar.isPending || encerrar.isPending || trocarViatura.isPending || pausar.isPending || retomar.isPending
            }
            parceiros={escala.data?.parceiros ?? []}
            emPausa={pausa ? MOTIVO_PAUSA_LABEL[pausa.motivo] : null}
            onPausar={() => pausar.mutate("almoco")}
            onRetomar={() => retomar.mutate()}
            viatura={rotuloViatura}
            /*
             * Tocar "Iniciar" ABRE a folha em vez de bater a jornada direto. A
             * troca e proposital: a viatura so pode ser declarada no comeco do
             * turno com uma pergunta, e perguntar depois seria perguntar tarde.
             * Quem foi a pe sai por "Sem veículo hoje", que fica em destaque.
             */
            /*
              Inicia DIRETO, sem folha de escolha: a viatura de hoje quem
              decide e o supervisor (escala), e o app so mostra o que foi
              escalado depois que o turno abre. Perguntar aqui daria a impressao
              de que a escolha ainda e do tecnico.
            */
            onIniciar={() => iniciar.mutate(undefined)}
            onEncerrar={confirmarEncerrar}
            onTrocarViatura={jornada ? () => setFolha("trocar") : undefined}
          />

          {/*
            Sem gate de modulo, de proposito. Declarar viatura e gesto da
            JORNADA, que e core — nao do modulo `frota`, cujo toggle governa as
            telas de frota no painel web.

            E gatear em `frota` esconderia isto de todo tecnico: as rolesPadrao
            do modulo sao [ADMIN, GESTOR] e o /config filtra por papel
            (apps/api/src/services/moduloService.ts:50), entao o tecnico nunca
            recebe `frota` na lista.
          */}
          {/*
            Aparece uma vez, no primeiro login deste aparelho. Mora AQUI e nao
            no `_layout`: um layout do expo-router tem que renderizar o
            navegador, e por um irmao ao lado dele em branqueia a tela inteira.
            Esta e a tela onde o tecnico cai depois de entrar, que e o momento
            certo pra pergunta de qualquer forma.
          */}
          <FolhaEscolhaAcesso visivel={preferencia === null} onEscolher={(p) => void definirPreferencia(p)} />

          <FolhaViatura
            visivel={folha !== null}
            titulo="Trocar de viatura"
            rotuloPular="Continuar sem veículo"
            ocupado={iniciar.isPending || trocarViatura.isPending}
            onFechar={() => setFolha(null)}
            onEscolher={(escolha) => aplicarViatura(escolha)}
            onSemVeiculo={() => aplicarViatura(undefined)}
          />

          {/* --- A única coisa acionável agora --- */}
          {fila.isLoading ? (
            <Card>
              <ActivityIndicator color={colors.brand} />
            </Card>
          ) : proxima ? (
            <ProximaOs
              titulo={`OS #${proxima.sgpOsId}${proxima.tipoDescricao ? ` — ${proxima.tipoDescricao}` : ""}`}
              cliente={proxima.clienteNome ?? "Cliente não identificado"}
              endereco={enderecoCurto(proxima)}
              horario={proxima.dataAgendamento ? `Agendada para ${hora(proxima.dataAgendamento)}` : null}
              prioridadeAlta={proxima.prioridade === OsPrioridade.ALTA}
              onVer={() => router.push(`/minhas-os/${proxima.id}`)}
              onIniciar={() => abrirNoWaze(proxima.endereco)}
              acaoLabel="Abrir no Waze"
            />
          ) : (
            <Card>
              <Muted>
                {fila.isError ? "Não foi possível carregar a fila." : "Nenhuma OS aberta atribuída a você."}
              </Muted>
            </Card>
          )}

          {/* --- Como o dia está rendendo --- */}
          <Secao titulo="Meu dia">
            <Card style={{ gap: space.md }}>
              <View style={styles.kpis}>
                <Kpi valor={m?.programadas ?? 0} label="Programadas" tom="brand" icone="calendar" />
                <Kpi valor={m?.concluidas ?? 0} label="Concluídas" tom="verde" icone="check-circle" />
                <Kpi valor={m?.pendentes ?? 0} label="Em andamento" tom="ambar" icone="clock" />
                <Kpi valor={m?.naoRealizadas ?? 0} label="Não realizadas" tom="vermelho" icone="x-circle" />
              </View>
              <BarraProgresso pct={m?.produtividade ?? 0} label="Produtividade do dia" />
            </Card>
          </Secao>

          {/* --- A linha do tempo do dia --- */}
          <Secao
            titulo="Agenda do dia"
            acao={
              agenda.data?.itens.length ? (
                <Text style={styles.secaoContagem}>{agenda.data.itens.length} paradas</Text>
              ) : undefined
            }
          >
            <Card style={{ paddingHorizontal: space.sm, paddingVertical: space.sm }}>
              {agenda.isLoading ? (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: space.md }} />
              ) : agenda.data?.itens.length ? (
                ordenarPorHorario(agenda.data.itens).map((os, i, arr) => (
                  <LinhaAgenda
                    key={os.id}
                    horario={os.dataAgendamento ? hora(os.dataAgendamento) : "--:--"}
                    titulo={`OS #${os.sgpOsId}${os.tipoDescricao ? ` — ${os.tipoDescricao}` : ""}`}
                    estado={estadoDaAgenda(os, proxima?.id)}
                    rotulo={rotuloDaAgenda(os, proxima?.id)}
                    onPress={() => router.push(`/minhas-os/${os.id}`)}
                    ultimo={i === arr.length - 1}
                  />
                ))
              ) : (
                <Muted style={{ padding: space.sm }}>Nenhuma OS agendada para hoje.</Muted>
              )}
            </Card>
          </Secao>

          {/* --- O que não merece aba --- */}
          <Secao titulo="Atalhos">
            <GradeAtalhos
              itens={[
                { id: "os", label: "Minhas OS", icone: "list", onPress: () => {}, badge: naFila },
                { id: "onu", label: "Provisionar", icone: "wifi", onPress: () => router.push("/provisionamento") },
                { id: "chat", label: "Suporte", icone: "message-circle", onPress: () => router.push("/chat") },
                { id: "perfil", label: "Perfil", icone: "user", onPress: () => router.push("/perfil") },
              ]}
            />
          </Secao>

          {/* --- A fila inteira, que continua sendo o trabalho --- */}
          <Secao titulo={grupo === "abertos" ? `Fila aberta (${naFila})` : `Concluídas (${naFila})`}>
            <View style={{ marginBottom: space.md }}>
              <Segmented
                value={grupo}
                onChange={setGrupo}
                options={[
                  { value: "abertos", label: "Abertas" },
                  { value: "fechados", label: "Concluídas" },
                ]}
              />
            </View>
            {/*
             * `truncado` era recebido e ignorado: a fila podia vir cortada e o
             * tecnico nao sabia que existia mais trabalho do que a tela mostrava.
             */}
            {fila.data?.truncado ? <Aviso texto={`Mostrando ${itens.length} de ${naFila}.`} /> : null}
            {itens.length === 0 && !fila.isLoading ? (
              <Muted>
                {grupo === "abertos"
                  ? "Nenhuma OS aberta atribuída a você."
                  : "Nenhuma OS concluída ou cancelada até agora."}
              </Muted>
            ) : (
              <View style={{ gap: space.md }}>
                {itens.map((item) => (
                  <FilaCard key={item.id} item={item} onPress={() => router.push(`/minhas-os/${item.id}`)} />
                ))}
              </View>
            )}
          </Secao>
        </View>
      </ScrollView>
    </Screen>
  );
}

/* ---------------------------------------------------------------- util --- */

/** "Sexta-feira, 07 de agosto" — o técnico confere o dia, não o ano. */
function dataPorExtenso(d: Date): string {
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function enderecoCurto(os: FilaItem): string | null {
  const e = os.endereco;
  if (!e) return os.pop ? `POP: ${os.pop}` : null;
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const resto = [e.bairro, e.cidade].filter(Boolean).join(" — ");
  return [rua, resto].filter(Boolean).join(" · ") || (os.pop ? `POP: ${os.pop}` : null);
}

function estadoDaAgenda(os: FilaItem, proximaId?: string): EstadoAgenda {
  if (os.status === OsStatus.CONCLUIDA) return "concluida";
  if (os.status === OsStatus.CANCELADA) return "problema";
  if (os.id === proximaId) return "proxima";
  if (os.status === OsStatus.EM_DESLOCAMENTO || os.status === OsStatus.EM_EXECUCAO) return "andamento";
  return "programada";
}

function rotuloDaAgenda(os: FilaItem, proximaId?: string): string {
  if (os.status === OsStatus.CONCLUIDA) return "Concluída";
  if (os.status === OsStatus.CANCELADA) return "Não realizada";
  if (os.id === proximaId) return "PRÓXIMA";
  if (os.status === OsStatus.EM_DESLOCAMENTO) return "A caminho";
  if (os.status === OsStatus.EM_EXECUCAO) return "Em execução";
  return "Programada";
}

const styles = StyleSheet.create({
  corpo: { paddingBottom: space.xxl },
  heroWrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  conteudo: { paddingHorizontal: space.lg, marginTop: -space.xl, gap: space.xl },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  secaoContagem: { fontSize: font.size.xs, color: colors.muted, fontWeight: font.weight.medium },
});
