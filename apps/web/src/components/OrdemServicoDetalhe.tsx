import { useEffect, useState, type ElementType } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  rotuloDataHora,
  OS_STATUS_LABEL,
  OS_STATUS_ABERTOS,
  OsStatus,
  UserRole,
  type DetalhesTecnicos,
  type Endereco,
  type FilaItem,
} from "@isphub/shared";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { frotaMapaApi } from "@/lib/veiculosApi";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge } from "@/components/SlaBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { ContratoStatusAcao } from "@/components/ContratoStatusAcao";
import { FichaSgpConexao, FichaSgpIdentificacao, useFichaSgp } from "@/components/FichaSgpOs";
import { ConexaoStatus } from "@/components/ConexaoStatus";
import { OsTimeline } from "@/components/OsTimeline";
import { EvidenciaGallery } from "@/components/EvidenciaGallery";
import { ordensServicoApi, tecnicosApi, type TecnicoResumo } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { CalendarDays, CalendarX2, CheckCircle2, ExternalLink, MapPinCheck, MapPinOff, MessageCircle, Navigation, Play, Route } from "lucide-react";
import { formatarKm } from "@isphub/shared";
import { MarcarVisitaDialog } from "@/components/MarcarVisitaDialog";
import { agendaApi, rotuloVisita } from "@/lib/agendaApi";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * O detalhe de uma OS — o MESMO corpo no dialogo da fila e na pagina /os/:id.
 * `emDialogo` so troca os elementos do cabecalho (DialogTitle precisa estar
 * dentro de um Dialog; na pagina vira h1). `onMudanca` avisa quem embute que
 * algo foi escrito e a lista de origem precisa re-buscar.
 */
export function OrdemServicoDetalhe({
  item,
  onMudanca,
  emDialogo = false,
}: {
  item: FilaItem;
  onMudanca: () => void;
  emDialogo?: boolean;
}) {
  const Cabecalho: ElementType = emDialogo ? DialogHeader : "div";
  const Titulo: ElementType = emDialogo ? DialogTitle : "h1";
  const Descricao: ElementType = emDialogo ? DialogDescription : "p";
  const { usuario } = useAuth();
  const podeDespachar = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;
  // Atendente so marca/remarca/desmarca visita: sem status, tecnico nem anotacao.
  const ehAtendente = usuario?.role === UserRole.ATENDENTE;
  const { toast } = useToast();
  const navigate = useNavigate();
  const [os, setOs] = useState(item);
  const [tecnicos, setTecnicos] = useState<TecnicoResumo[]>([]);
  const [tecnicoSelecionado, setTecnicoSelecionado] = useState("");
  const [novoStatus, setNovoStatus] = useState<OsStatus>(item.status);
  const [textoAnotacao, setTextoAnotacao] = useState("");
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const [detalhesLive, setDetalhesLive] = useState<DetalhesTecnicos | null>(null);
  const [marcandoVisita, setMarcandoVisita] = useState(false);
  // Dois toques pra desmarcar: o primeiro so pergunta. Inline, sem outro
  // dialogo em cima de um dialogo.
  const [confirmandoDesmarcar, setConfirmandoDesmarcar] = useState(false);
  // Quanto a viatura rodou ate aqui — so existe depois de a OS ter sido executada.
  const [deslocamento, setDeslocamento] = useState<{ metros: number; fonte: "gps" | "estimado" | "sem_dados" } | null>(null);
  // Auditoria de presenca: so existe depois de concluida; "sem dados" nao aparece.
  const [auditoria, setAuditoria] = useState<{ veredito: "presente" | "ausente"; distanciaMinMetros: number | null } | null>(null);
  useEffect(() => {
    if (!podeDespachar || os.status !== OsStatus.CONCLUIDA) return;
    let vivo = true;
    ordensServicoApi
      .auditoria(os.id)
      .then((a) => vivo && setAuditoria(a && a.veredito !== "sem_dados" ? (a as { veredito: "presente" | "ausente"; distanciaMinMetros: number | null }) : null))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [podeDespachar, os.id, os.status]);
  useEffect(() => {
    if (!podeDespachar) return;
    let vivo = true;
    ordensServicoApi
      .deslocamento(os.id)
      .then((d) => vivo && setDeslocamento(d && d.fonte !== "sem_dados" ? d : null))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [podeDespachar, os.id, os.status]);

  // Fala com o cliente pelo WhatsApp da empresa (canal do AtendAI do provedor).
  async function handleConversarComCliente() {
    setAcaoEmCurso("conversa-cliente");
    try {
      const { conversaId } = await ordensServicoApi.conversaCliente(os.id);
      navigate(`/chat-clientes?conversa=${conversaId}`);
    } catch (err) {
      toast({ titulo: "Não foi possível abrir a conversa", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleDesmarcar() {
    if (!os.agendamentoId) return;
    setAcaoEmCurso("desmarcar");
    try {
      await agendaApi.desmarcar(os.agendamentoId);
      setOs((atual) => ({ ...atual, diaAgenda: null, turnoAgenda: null, agendamentoId: null, ordemRota: null }));
      marcarMudanca();
      toast({ titulo: "Visita desmarcada", descricao: "A vaga voltou para a grade.", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível desmarcar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
      setConfirmandoDesmarcar(false);
    }
  }

  // Uma consulta por dialog, consumida por DUAS abas (Detalhes e Conexão).
  // Ver a nota em useFichaSgp: um componente por aba faria o Radix desmontar e
  // remontar o fetch a cada troca.
  const { ficha, estado: estadoFicha } = useFichaSgp(os.id);

  useEffect(() => {
    if (!podeDespachar) return;
    tecnicosApi
      .listar()
      .then(setTecnicos)
      .catch(() => {});
  }, [podeDespachar]);

  /*
   * Qual VIATURA fez esta OS — derivado do cruzamento da janela de execucao com
   * as ocupacoes do tecnico. E LISTA porque podem ter sido duas: o carro que
   * quebrou de manha e o que terminou o dia.
   *
   * O gate `podeDespachar` nao e zelo: `GET /frota/ordens-servico/:id/veiculos`
   * e ADMIN/GESTOR, e sem ele o tecnico tomaria 403 ao abrir a PROPRIA OS.
   */
  const [viaturas, setViaturas] = useState<{ veiculoId: string; veiculoPlaca: string; veiculoRotulo: string; usuarioNome: string }[]>([]);
  useEffect(() => {
    if (!podeDespachar) return;
    frotaMapaApi
      .veiculosDaOs(os.id)
      .then(setViaturas)
      .catch(() => {});
  }, [podeDespachar, os.id]);

  const marcarMudanca = onMudanca;

  async function handleACaminho() {
    setAcaoEmCurso("acaminho");
    try {
      const atualizado = await ordensServicoApi.aCaminho(os.id);
      setOs((prev) => ({ ...prev, status: atualizado.status as OsStatus }));
      toast({ titulo: "OS marcada como a caminho", variante: "sucesso" });
      marcarMudanca();
    } catch (err) {
      toast({ titulo: "Erro ao marcar a caminho", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleMudarStatus(alvo: OsStatus = novoStatus) {
    setAcaoEmCurso("status");
    try {
      const atualizado = await ordensServicoApi.mudarStatus(os.id, alvo);
      setOs((prev) => ({ ...prev, status: atualizado.status as OsStatus }));
      toast({ titulo: "Status atualizado", variante: "sucesso" });
      marcarMudanca();
    } catch (err) {
      toast({ titulo: "Erro ao atualizar status", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
    }
  }

  // O próximo passo natural do fluxo. Concluída/cancelada não têm próximo:
  // reabrir é exceção e fica no select.
  const proximoPasso =
    os.status === OsStatus.ABERTA || os.status === OsStatus.PENDENTE
      ? { rotulo: "Marcar a caminho", Icone: Navigation, executar: () => void handleACaminho() }
      : os.status === OsStatus.EM_DESLOCAMENTO
        ? { rotulo: "Iniciar atendimento", Icone: Play, executar: () => void handleMudarStatus(OsStatus.EM_EXECUCAO) }
        : os.status === OsStatus.EM_EXECUCAO
          ? { rotulo: "Concluir atendimento", Icone: CheckCircle2, executar: () => void handleMudarStatus(OsStatus.CONCLUIDA) }
          : null;

  async function handleAnotar() {
    if (!textoAnotacao.trim()) return;
    setAcaoEmCurso("anotacao");
    try {
      const atualizado = await ordensServicoApi.anotar(os.id, textoAnotacao.trim());
      setOs((prev) => ({ ...prev, observacao: atualizado.observacao }));
      setTextoAnotacao("");
      toast({ titulo: "Anotação enviada ao SGP", variante: "sucesso" });
      marcarMudanca();
    } catch (err) {
      toast({ titulo: "Erro ao adicionar anotação", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleAtribuir() {
    if (!tecnicoSelecionado) return;
    setAcaoEmCurso("atribuir");
    try {
      const atualizado = await ordensServicoApi.atribuir(os.id, tecnicoSelecionado);
      const tecnico = tecnicos.find((t) => t.id === tecnicoSelecionado);
      setOs((prev) => ({ ...prev, tecnicoId: atualizado.tecnicoId, tecnicoNome: tecnico?.nome ?? prev.tecnicoNome }));
      toast({ titulo: "Técnico atribuído", descricao: "Despacho interno do ISPhub — o SGP não é alterado.", variante: "sucesso" });
      marcarMudanca();
    } catch (err) {
      toast({ titulo: "Erro ao atribuir técnico", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
    }
  }

  return (
    <>
      <Cabecalho className={emDialogo ? undefined : "flex flex-col gap-1.5"}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground">
            OS #{os.sgpOsId}
          </span>
          <ProvedorBadge provedor={os.provedor} />
          <StatusBadge status={os.status} />
          <ContratoStatusBadge status={os.contratoStatus} />
          {emDialogo && (
            // A pagina propria serve pra compartilhar (link) e pra abrir em
            // outra aba sem perder a fila filtrada.
            <Link
              to={`/os/${os.id}`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              title="Abrir a OS em uma página própria"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Abrir em página
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Titulo className={emDialogo ? undefined : "text-xl font-semibold text-foreground"}>
            {os.clienteNome ?? "Cliente não identificado"}
          </Titulo>
          <SlaBadge sla={os.sla} />
        </div>
        <Descricao className={emDialogo ? undefined : "text-sm text-muted-foreground"}>
          {os.tipoDescricao ?? "OS"}
          {os.protocolo ? ` · Protocolo ${os.protocolo}` : ""}
        </Descricao>
      </Cabecalho>

      {os.telefone && usuario?.role !== UserRole.PROVEDOR ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => void handleConversarComCliente()} disabled={acaoEmCurso !== null}>
            <MessageCircle className="size-4" aria-hidden />
            {acaoEmCurso === "conversa-cliente" ? "Abrindo conversa..." : "Conversar com o cliente"}
          </Button>
        </div>
      ) : null}

      {/*
        A acao fica no DETALHE, nao no badge: o badge tambem aparece no card
        da fila e no popup do mapa, onde um controle de escrita no ERP seria
        um clique acidental esperando acontecer.
      */}
      <ContratoStatusAcao
        os={os}
        onAtualizado={(atualizado) => {
          // Mesmo padrao das outras acoes: atualiza o eco local (a tela reage
          // na hora) e avisa o pai pra fila re-buscar.
          setOs((prev) => ({ ...prev, contratoStatus: atualizado.contratoStatus }));
          marcarMudanca();
        }}
      />

      <Tabs defaultValue="detalhes">
        <TabsList>
          <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
          <TabsTrigger value="conexao">Conexão</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="fotos">Fotos</TabsTrigger>
        </TabsList>

        <TabsContent value="detalhes">
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Info label="Contrato" value={os.contratoId} />
            <Info label="Técnico" value={os.tecnicoNome} />
            {os.apoioNomes?.length ? <Info label="Apoio" value={os.apoioNomes.join(", ")} /> : null}
            {podeDespachar && viaturas.length > 0 ? (
              <Info
                label={viaturas.length > 1 ? "Viaturas" : "Viatura"}
                value={[...new Set(viaturas.map((v) => v.veiculoRotulo))].join(" · ")}
              />
            ) : null}
            <Info label="Designado no SGP" value={os.tecnicoSgpNome} />
            <Info
              label="Endereço"
              value={enderecoTexto(detalhesLive?.endereco ?? null) ?? enderecoTexto(os.endereco)}
            />
            <Info label="Localização (POP)" value={os.pop} />
            <Info
              label="Aberta em"
              value={os.dataCadastro ? rotuloDataHora(os.dataCadastro) : undefined}
            />
            <Info
              label="Agendamento"
              value={os.dataAgendamento ? rotuloDataHora(os.dataAgendamento) : undefined}
            />
            <Info label="Registrado por" value={os.usuario} />
          </div>

          {/* Descricao e somente-leitura: a API do SGP nao expoe edicao
              desse campo, so acrescentar anotacao (ver connector.ts). */}
          {os.conteudo && (
            <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
              {os.conteudo}
            </div>
          )}
          {os.observacao && (
            <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <span className="font-medium">Última anotação: </span>
              {os.observacao}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ações</p>
            {/*
              Um botão grande para o PRÓXIMO passo do fluxo (a caminho →
              iniciar → concluir): é o que se faz 9 em cada 10 vezes, e antes
              exigia escolher no select e depois clicar em "Atualizar status".
              O select fica embaixo, discreto, pra quem precisa pular etapa,
              cancelar ou reabrir.
            */}
            {!ehAtendente && proximoPasso ? (
              <Button
                variant="brand"
                onClick={proximoPasso.executar}
                disabled={acaoEmCurso !== null}
                className="h-11 w-full text-base sm:w-auto sm:self-start sm:px-6"
              >
                <proximoPasso.Icone className="size-4" />
                {acaoEmCurso ? "Enviando..." : proximoPasso.rotulo}
              </Button>
            ) : null}
            {!ehAtendente && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {/* "A caminho" de novo continua possível com a OS já em
                  deslocamento ou execução (técnico saiu, voltou à rua): a API
                  aceita e grava a posição de saída. Só não é o botão grande. */}
              {proximoPasso?.rotulo !== "Marcar a caminho" && OS_STATUS_ABERTOS.includes(os.status) ? (
                <Button variant="outline" size="sm" onClick={() => void handleACaminho()} disabled={acaoEmCurso !== null}>
                  <Navigation className="size-3.5" />
                  Marcar a caminho
                </Button>
              ) : null}
              <span className="text-muted-foreground">Outro status:</span>
              <Select
                /*
                 * Sem rotulo, este <select> so era alcancavel por
                 * `combobox.first()` — que passou a casar com OUTRO seletor
                 * assim que um novo apareceu antes dele no dialogo. Leitor de
                 * tela tinha o mesmo problema, sem a saida do `.first()`.
                 */
                aria-label="Novo status da OS"
                value={novoStatus}
                onChange={(e) => setNovoStatus(e.target.value as OsStatus)}
                className="h-9 w-auto bg-secondary/40 px-2"
              >
                {Object.values(OsStatus).map((s) => (
                  <option key={s} value={s}>
                    {OS_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleMudarStatus()}
                disabled={acaoEmCurso !== null || novoStatus === os.status}
              >
                {acaoEmCurso === "status" ? "Atualizando..." : "Atualizar status"}
              </Button>
            </div>
            )}

            {(podeDespachar || ehAtendente) && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {ehAtendente ? "Visita" : "Despacho"}
                </p>
                {/* A visita vem ANTES do tecnico: primeiro cabe no dia, depois
                    alguem vai. A agenda (nao o SGP) e a fonte da verdade da data. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMarcandoVisita(true)}
                    disabled={acaoEmCurso !== null || !OS_STATUS_ABERTOS.includes(os.status)}
                  >
                    <CalendarDays className="size-3.5" />
                    {os.diaAgenda && os.turnoAgenda ? "Remarcar visita" : "Marcar visita"}
                  </Button>
                  {os.diaAgenda && os.turnoAgenda && (
                    <span className="text-sm text-muted-foreground">
                      Visita: <span className="font-medium text-foreground">{rotuloVisita(os.diaAgenda, os.turnoAgenda)}</span>
                    </span>
                  )}
                  {auditoria && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${auditoria.veredito === "presente" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
                      title={
                        auditoria.veredito === "presente"
                          ? `A viatura passou a ${auditoria.distanciaMinMetros} m do endereço durante a execução`
                          : `A viatura não passou pelo endereço (distância mínima ${auditoria.distanciaMinMetros} m)`
                      }
                    >
                      {auditoria.veredito === "presente" ? <MapPinCheck className="size-3.5" /> : <MapPinOff className="size-3.5" />}
                      {auditoria.veredito === "presente" ? "Viatura esteve no local" : "Viatura não passou no local"}
                    </span>
                  )}
                  {deslocamento && (
                    <span
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground"
                      title={deslocamento.fonte === "gps" ? "Medido pelo rastreador da viatura" : "Estimado pela distância em linha reta"}
                    >
                      <Route className="size-3.5" aria-hidden />
                      Deslocamento até aqui: <span className="font-medium text-foreground">{formatarKm(deslocamento.metros)}</span>
                      {deslocamento.fonte === "estimado" ? <span className="text-xs">(estimado)</span> : null}
                    </span>
                  )}
                  {os.agendamentoId &&
                    (confirmandoDesmarcar ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <span className="text-muted-foreground">Desmarcar?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleDesmarcar}
                          disabled={acaoEmCurso !== null}
                        >
                          {acaoEmCurso === "desmarcar" ? "Desmarcando..." : "Sim, desmarcar"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmandoDesmarcar(false)} disabled={acaoEmCurso !== null}>
                          Não
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmandoDesmarcar(true)}
                        disabled={acaoEmCurso !== null}
                      >
                        <CalendarX2 className="size-3.5" />
                        Desmarcar
                      </Button>
                    ))}
                </div>
                {podeDespachar && (
                <div className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label="Atribuir técnico"
                  value={tecnicoSelecionado}
                  onChange={(e) => setTecnicoSelecionado(e.target.value)}
                  className="flex-1 bg-secondary/40 px-2"
                >
                  <option value="">Atribuir técnico...</option>
                  {tecnicos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAtribuir}
                  disabled={acaoEmCurso !== null || !tecnicoSelecionado}
                >
                  {acaoEmCurso === "atribuir" ? "Atribuindo..." : "Atribuir"}
                </Button>
                </div>
                )}
              </div>
            )}

            {/* Cadastro do assinante, ponto de referencia e o que ja foi
                registrado na OS. Plano/sinal/PPPoE ficam na aba Conexão. */}
            <FichaSgpIdentificacao ficha={ficha} estado={estadoFicha} />

            {!ehAtendente && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anotação</p>
              <textarea
                value={textoAnotacao}
                onChange={(e) => setTextoAnotacao(e.target.value)}
                placeholder="Adicionar anotação (enviada ao SGP)..."
                rows={2}
                className="w-full resize-none rounded-md border border-input bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={handleAnotar}
                disabled={acaoEmCurso !== null || !textoAnotacao.trim()}
              >
                {acaoEmCurso === "anotacao" ? "Enviando..." : "Adicionar anotação"}
              </Button>
            </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="conexao" className="flex flex-col gap-4">
          {/*
            A sonda AO VIVO saiu do cabecalho e veio pra ca. Manter o botao
            la em cima enquanto existe uma aba "Conexão" espalharia a mesma
            preocupacao em dois lugares — e era justamente o que criava a
            duvida "qual dBm vale?": agora o valor de agora e o ultimo
            registrado aparecem um ao lado do outro, cada um rotulado.
          */}
          <ConexaoStatus provedorId={os.provedorId} contratoId={os.contratoId} onDetalhes={setDetalhesLive} />
          <FichaSgpConexao ficha={ficha} estado={estadoFicha} />
        </TabsContent>

        <TabsContent value="historico">
          <OsTimeline ordemServicoId={os.id} />
        </TabsContent>

        <TabsContent value="fotos">
          <EvidenciaGallery ordemServicoId={os.id} />
        </TabsContent>
      </Tabs>
      {marcandoVisita && (
        <MarcarVisitaDialog
          item={os}
          onClose={() => setMarcandoVisita(false)}
          onMarcado={(dia, turno, id) => {
            setOs((atual) => ({ ...atual, diaAgenda: dia, turnoAgenda: turno, agendamentoId: id }));
            marcarMudanca();
            setMarcandoVisita(false);
          }}
        />
      )}
    </>
  );
}

function enderecoTexto(endereco: Endereco | null): string | undefined {
  if (!endereco?.logradouro) return undefined;
  const bairro = endereco.bairro ? ` — ${endereco.bairro}` : "";
  return `${endereco.logradouro}, ${endereco.numero ?? "s/n"}${bairro}`;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
