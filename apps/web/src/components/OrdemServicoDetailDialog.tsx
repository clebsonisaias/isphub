import { useEffect, useState } from "react";
import {
  OS_STATUS_LABEL,
  OS_STATUS_ABERTOS,
  OsStatus,
  UserRole,
  type DetalhesTecnicos,
  type Endereco,
  type FilaItem,
} from "@isphub/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge } from "@/components/SlaBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { FichaSgpOs } from "@/components/FichaSgpOs";
import { ConexaoStatus } from "@/components/ConexaoStatus";
import { OsTimeline } from "@/components/OsTimeline";
import { EvidenciaGallery } from "@/components/EvidenciaGallery";
import { ordensServicoApi, tecnicosApi, type TecnicoResumo } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Navigation } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function OrdemServicoDetailDialog({
  item,
  onClose,
  onAtualizado,
}: {
  item: FilaItem;
  onClose: () => void;
  onAtualizado: () => void;
}) {
  const { usuario } = useAuth();
  const podeDespachar = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;
  const { toast } = useToast();
  const [os, setOs] = useState(item);
  const [tecnicos, setTecnicos] = useState<TecnicoResumo[]>([]);
  const [tecnicoSelecionado, setTecnicoSelecionado] = useState("");
  const [novoStatus, setNovoStatus] = useState<OsStatus>(item.status);
  const [textoAnotacao, setTextoAnotacao] = useState("");
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const [houveMudanca, setHouveMudanca] = useState(false);
  const [detalhesLive, setDetalhesLive] = useState<DetalhesTecnicos | null>(null);

  useEffect(() => {
    if (!podeDespachar) return;
    tecnicosApi
      .listar()
      .then(setTecnicos)
      .catch(() => {});
  }, [podeDespachar]);

  function marcarMudanca() {
    setHouveMudanca(true);
  }

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

  async function handleMudarStatus() {
    setAcaoEmCurso("status");
    try {
      const atualizado = await ordensServicoApi.mudarStatus(os.id, novoStatus);
      setOs((prev) => ({ ...prev, status: atualizado.status as OsStatus }));
      toast({ titulo: "Status atualizado", variante: "sucesso" });
      marcarMudanca();
    } catch (err) {
      toast({ titulo: "Erro ao atualizar status", descricao: mensagem(err), variante: "erro" });
    } finally {
      setAcaoEmCurso(null);
    }
  }

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

  function handleOpenChange(open: boolean) {
    if (!open) {
      if (houveMudanca) onAtualizado();
      else onClose();
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground">
              OS #{os.sgpOsId}
            </span>
            <ProvedorBadge provedor={os.provedor} />
            <StatusBadge status={os.status} />
            <ContratoStatusBadge status={os.contratoStatus} />
            <ConexaoStatus provedorId={os.provedorId} contratoId={os.contratoId} onDetalhes={setDetalhesLive} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <DialogTitle>{os.clienteNome ?? "Cliente não identificado"}</DialogTitle>
            <SlaBadge sla={os.sla} />
          </div>
          <DialogDescription>
            {os.tipoDescricao ?? "OS"}
            {os.protocolo ? ` · Protocolo ${os.protocolo}` : ""}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="detalhes">
          <TabsList>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="fotos">Fotos</TabsTrigger>
          </TabsList>

          <TabsContent value="detalhes">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Info label="Contrato" value={os.contratoId} />
              <Info label="Técnico" value={os.tecnicoNome} />
              <Info label="Designado no SGP" value={os.tecnicoSgpNome} />
              <Info
                label="Endereço"
                value={enderecoTexto(detalhesLive?.endereco ?? null) ?? enderecoTexto(os.endereco)}
              />
              <Info label="Localização (POP)" value={os.pop} />
              <Info
                label="Aberta em"
                value={os.dataCadastro ? new Date(os.dataCadastro).toLocaleString("pt-BR") : undefined}
              />
              <Info
                label="Agendamento"
                value={os.dataAgendamento ? new Date(os.dataAgendamento).toLocaleString("pt-BR") : undefined}
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleACaminho}
                  disabled={acaoEmCurso !== null || !OS_STATUS_ABERTOS.includes(os.status)}
                >
                  <Navigation className="size-3.5" />
                  {acaoEmCurso === "acaminho" ? "Enviando..." : "Marcar a caminho"}
                </Button>

                <select
                  value={novoStatus}
                  onChange={(e) => setNovoStatus(e.target.value as OsStatus)}
                  className="h-9 rounded-md border border-input bg-secondary/40 px-2 text-sm"
                >
                  {Object.values(OsStatus).map((s) => (
                    <option key={s} value={s}>
                      {OS_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="brand"
                  size="sm"
                  onClick={handleMudarStatus}
                  disabled={acaoEmCurso !== null || novoStatus === os.status}
                >
                  {acaoEmCurso === "status" ? "Atualizando..." : "Atualizar status"}
                </Button>
              </div>

              {podeDespachar && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Despacho</p>
                  <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={tecnicoSelecionado}
                    onChange={(e) => setTecnicoSelecionado(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-input bg-secondary/40 px-2 text-sm"
                  >
                    <option value="">Atribuir técnico...</option>
                    {tecnicos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAtribuir}
                    disabled={acaoEmCurso !== null || !tecnicoSelecionado}
                  >
                    {acaoEmCurso === "atribuir" ? "Atribuindo..." : "Atribuir"}
                  </Button>
                  </div>
                </div>
              )}

              {/* Ficha do SGP: plano, PPPoE, ponto de referencia. Carrega depois
                  e some sozinha se o SGP nao responder — o dialog nao depende dela. */}
              <FichaSgpOs ordemServicoId={os.id} />

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
            </div>
          </TabsContent>

          <TabsContent value="historico">
            <OsTimeline ordemServicoId={os.id} />
          </TabsContent>

          <TabsContent value="fotos">
            <EvidenciaGallery ordemServicoId={os.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
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
