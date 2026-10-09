import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  OsPrioridade,
  OsStatus,
  PAPEL_OCUPACAO_ROTULO,
  ROTULO_TURNO,
  TURNOS_AGENDA,
  diaBrHoje,
  ehAtivo,
  filtroDoDia,
  rotuloDoTexto,
  rotuloQuando,
  temDestino,
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
  Kpi,
  LinhaAgenda,
  ProximaOs,
  Secao,
  type EstadoAgenda,
} from "@/components/painel-dia";
import { colors, font, space } from "@/theme/tokens";
import { Avatar, useAvatarUri } from "@/features/chat/avatar";
import { FilaCard } from "@/features/minhas-os/fila-card";
import { agruparPorTurno, escolherProxima, maisRecentesPrimeiro, ordenarSlaFirst } from "@/features/minhas-os/sla";
import { abrirNoWaze } from "@/features/minhas-os/navegacao";
import { useEscalaDoDia, useJornada, useMinhaViatura, useRelogioServidor } from "@/features/jornada/api";
import { FolhaViatura, type EscolhaViatura } from "@/features/jornada/viatura";
import { FolhaChecklist } from "@/features/jornada/checklist";
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

  /*
   * A agenda do dia le a AGENDA ISPHUB (`diaAgenda`): visita marcada no painel
   * aparece aqui no mesmo instante, sem esperar o write-back nem o sync. A
   * consulta antiga, pela data do SGP, fica como fallback so quando a agenda
   * vem vazia — provedor que ainda agenda direto no SGP continua enxergando.
   */
  const hojeBr = diaBrHoje();
  const agendaIsphub = useQuery({
    queryKey: ["fila", "agenda-isphub", hojeBr],
    enabled: !!token,
    queryFn: () => apiFetch<FilaResp>(`/fila${buildFilaQuery({ equipe: "interna", diaAgenda: hojeBr })}`, { token }),
  });
  const agendaSgp = useQuery({
    queryKey: ["fila", "agenda-dia", dia.de],
    enabled: !!token && agendaIsphub.isSuccess && agendaIsphub.data.itens.length === 0,
    queryFn: () =>
      apiFetch<FilaResp>(`/fila${buildFilaQuery({ equipe: "interna", de: dia.de, ate: dia.ate })}`, { token }),
  });
  const agendaItens = agendaIsphub.data?.itens.length ? agendaIsphub.data.itens : (agendaSgp.data?.itens ?? []);
  const agendaCarregando = agendaIsphub.isLoading || agendaSgp.isLoading;
  const pelaAgendaIsphub = (agendaIsphub.data?.itens.length ?? 0) > 0;

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
  // Checklist da viatura: pedido ao sair (se a escala deu carro) e ao encerrar (se esta num carro).
  const [checklist, setChecklist] = useState<"saida" | "retorno" | null>(null);
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
   * A proxima parada segue a ROTA do dia quando o supervisor a definiu; so sem
   * agenda e que a urgencia por SLA decide (ver `escolherProxima`).
   */
  const proxima = escolherProxima(itens, agendaItens);
  const porTurno = agruparPorTurno(agendaItens);

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
      await Promise.all([fila.refetch(), agendaIsphub.refetch(), agendaSgp.isSuccess ? agendaSgp.refetch() : undefined, resumo.refetch()]);
    } finally {
      setSincronizando(false);
    }
  }

  function confirmarEncerrar() {
    // Encerrar e irreversivel pela tela (nao ha "reabrir jornada") e acontece
    // com o celular na mao no fim do dia — merece um passo a mais.
    Alert.alert("Encerrar jornada?", `Você está em serviço há ${tempoJornada ?? "pouco"}.`, [
      { text: "Continuar trabalhando", style: "cancel" },
      // Com viatura, o encerramento passa pelo checklist de retorno (km, combustivel, avarias).
      { text: "Encerrar", style: "destructive", onPress: () => (minhaViatura.data ? setChecklist("retorno") : encerrar.mutate(undefined)) },
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
            // Escalado com carro: checklist de saida antes (km e foto do painel). A pe: inicia direto.
            onIniciar={() => (escala.data?.veiculoId ? setChecklist("saida") : iniciar.mutate(undefined))}
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

          <FolhaChecklist
            visivel={checklist !== null}
            momento={checklist ?? "saida"}
            viatura={
              checklist === "retorno"
                ? rotuloViatura
                : escala.data?.veiculoPlaca
                  ? formatarPlaca(escala.data.veiculoPlaca)
                  : null
            }
            kmAnterior={minhaViatura.data?.odometroInicio ?? null}
            ocupado={iniciar.isPending || encerrar.isPending}
            onFechar={() => setChecklist(null)}
            onConfirmar={({ odometro, checklist: dados }) => {
              const momento = checklist;
              setChecklist(null);
              if (momento === "retorno") encerrar.mutate({ odometro, checklist: dados });
              else iniciar.mutate({ odometro, checklist: dados });
            }}
          />

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
              horario={proxima.dataAgendamento ? `Agendada para ${rotuloQuando(proxima.dataAgendamento)}` : null}
              prioridadeAlta={proxima.prioridade === OsPrioridade.ALTA}
              alerta={
                proxima.contratoStatus && !ehAtivo(proxima.contratoStatus)
                  ? `Contrato ${rotuloDoTexto(proxima.contratoStatus)} — confira antes de sair.`
                  : null
              }
              onVer={() => router.push(`/minhas-os/${proxima.id}`)}
              onIniciar={temDestino(proxima.endereco) ? () => abrirNoWaze(proxima.endereco) : undefined}
              onLigar={proxima.telefone ? () => void Linking.openURL(`tel:${proxima.telefone!.replace(/[^\d+]/g, "")}`) : undefined}
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
                {/* Neutros; cor so quando o numero significa algo. Quatro blocos
                    coloridos com zero, as 8h, eram so decoracao — e "Não
                    realizadas" vermelho em 0 assustava sem motivo. */}
                <Kpi valor={m?.programadas ?? 0} label="Programadas" icone="calendar" />
                <Kpi valor={m?.concluidas ?? 0} label="Concluídas" tom={(m?.concluidas ?? 0) > 0 ? "verde" : "neutro"} icone="check-circle" />
                <Kpi valor={m?.pendentes ?? 0} label="Em andamento" icone="clock" />
                <Kpi valor={m?.naoRealizadas ?? 0} label="Não realizadas" tom={(m?.naoRealizadas ?? 0) > 0 ? "vermelho" : "neutro"} icone="x-circle" />
              </View>
              <BarraProgresso pct={m?.produtividade ?? 0} label="Produtividade do dia" />
            </Card>
          </Secao>

          {/* --- A linha do tempo do dia --- */}
          <Secao
            titulo="Agenda do dia"
            acao={
              agendaItens.length ? (
                <Text style={styles.secaoContagem}>
                  {agendaItens.length} {agendaItens.length === 1 ? "parada" : "paradas"}
                </Text>
              ) : undefined
            }
          >
            <Card style={{ paddingHorizontal: space.sm, paddingVertical: space.sm }}>
              {agendaCarregando ? (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: space.md }} />
              ) : agendaItens.length ? (
                TURNOS_AGENDA.filter((t) => porTurno[t].length > 0).map((t) => (
                  <View key={t} style={{ gap: 2 }}>
                    <Text style={styles.turnoTitulo}>{ROTULO_TURNO[t]}</Text>
                    {porTurno[t].map((os, i, arr) => (
                      <LinhaAgenda
                        key={os.id}
                        // Com rota, a coluna da esquerda e a PARADA ("3ª"); sem rota, a hora do SGP.
                        horario={os.ordemRota != null ? `${os.ordemRota}ª` : os.dataAgendamento ? hora(os.dataAgendamento) : "--:--"}
                        titulo={`OS #${os.sgpOsId}${os.categoria?.nome ? ` — ${os.categoria.nome}` : os.tipoDescricao ? ` — ${os.tipoDescricao}` : ""}`}
                        estado={estadoDaAgenda(os, proxima?.id)}
                        rotulo={rotuloDaAgenda(os, proxima?.id)}
                        onPress={() => router.push(`/minhas-os/${os.id}`)}
                        ultimo={i === arr.length - 1}
                      />
                    ))}
                  </View>
                ))
              ) : (
                <Muted style={{ padding: space.sm }}>Nenhuma visita marcada para hoje.</Muted>
              )}
              {!agendaCarregando && agendaItens.length > 0 && !pelaAgendaIsphub ? (
                <Muted style={{ paddingHorizontal: space.sm, paddingTop: space.xs, fontSize: 11 }}>
                  Pela data do SGP — nenhuma visita marcada na agenda ISPhub hoje.
                </Muted>
              ) : null}
            </Card>
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
  turnoTitulo: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: space.sm,
    paddingTop: space.xs,
  },
  heroWrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  conteudo: { paddingHorizontal: space.lg, marginTop: -space.xl, gap: space.xl },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  secaoContagem: { fontSize: font.size.xs, color: colors.muted, fontWeight: font.weight.medium },
});
