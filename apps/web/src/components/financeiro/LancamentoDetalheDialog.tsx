import { useCallback, useEffect, useRef, useState } from "react";
import {
  rotuloDataHora,
  FORMA_PAGAMENTO_ROTULO,
  ORIGEM_ROTULO,
  formatarCompetencia,
  formatarDataIso,
  formatarMoeda,
  type LancamentoEventoPublic,
  type LancamentoEventoTipo,
  type LancamentoPublic,
} from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { financeiroApi } from "@/lib/financeiroApi";
import { api, ApiError } from "@/lib/apiClient";
import { blobParaBase64 } from "@/lib/arquivo";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { Ban, FileText, Paperclip, Pencil, Trash2 } from "lucide-react";

/** PDF ou imagem, ate 3MB — os mesmos limites que a API aplica. */
const MIMES_ACEITOS = "application/pdf,image/jpeg,image/png,image/webp";
const LIMITE_BYTES = 3 * 1024 * 1024;

const ROTULO_EVENTO: Record<LancamentoEventoTipo, string> = {
  criado: "Criado",
  editado: "Editado",
  baixado: "Baixa registrada",
  estornado: "Baixa estornada",
  cancelado: "Cancelado",
};

/**
 * Detalhe do lancamento: dados, comprovante e TRILHA DE AUDITORIA.
 *
 * O historico existia no banco desde a primeira fatia e nao tinha como ser
 * visto — o dado estava gravado e invisivel, que na pratica e o mesmo que nao
 * existir quando alguem pergunta "quem deu baixa nisso?".
 */
export function LancamentoDetalheDialog({
  lancamento,
  onFechar,
  onMudou,
  onEditar,
}: {
  lancamento: LancamentoPublic | null;
  onFechar: () => void;
  onMudou: () => void;
  onEditar: (l: LancamentoPublic) => void;
}) {
  const { toast } = useToast();
  const [eventos, setEventos] = useState<LancamentoEventoPublic[] | null>(null);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  /*
   * O ultimo lancamento visto, pra renderizar o conteudo DURANTE o fechamento.
   *
   * Sem isto o componente fazia `return null` assim que `lancamento` virava
   * null — e o Radix era arrancado da arvore com `open` ainda true, sem rodar a
   * limpeza dele. Sobravam `aria-hidden="true"` no #root e
   * `pointer-events: none` no body: a aplicacao INTEIRA ficava inerte depois de
   * fechar o detalhe, e so um F5 devolvia. Medido, nao deduzido.
   *
   * Mantendo o conteudo montado, `open={false}` faz o Radix fechar do jeito
   * dele e desfazer o que aplicou.
   */
  const [dados, setDados] = useState<LancamentoPublic | null>(lancamento);
  useEffect(() => {
    if (lancamento) setDados(lancamento);
  }, [lancamento]);

  const id = lancamento?.id;

  /**
   * Recarrega ESTE lancamento, sem passar pelo pai.
   *
   * O pai recarregando o detalhe criava uma corrida: `cancelar()` chamava
   * `onMudou()` (async) e `onFechar()` em seguida; a busca terminava DEPOIS do
   * fechamento e reabria o dialogo que o usuario tinha acabado de fechar.
   * Cada um cuidando do proprio estado, a corrida deixa de existir.
   */
  const recarregarEste = useCallback(async () => {
    if (!id) return;
    const fresco = await financeiroApi.obter(id).catch(() => null);
    if (fresco) setDados(fresco);
  }, [id]);

  const carregarHistorico = useCallback(() => {
    if (!id) return;
    setEventos(null);
    financeiroApi.historico(id).then(setEventos).catch(() => setEventos([]));
  }, [id]);

  useEffect(() => {
    carregarHistorico();
    setConfirmandoCancelamento(false);
    setMotivo("");
  }, [carregarHistorico]);

  async function enviarComprovante(arquivo: File) {
    if (!lancamento) return;
    // Valida no cliente ANTES de subir 3MB pra receber 400 do outro lado.
    if (arquivo.size > LIMITE_BYTES) {
      toast({ titulo: "Arquivo maior que 3MB", variante: "erro" });
      return;
    }
    setOcupado(true);
    try {
      const base64 = await blobParaBase64(arquivo);
      await financeiroApi.enviarComprovante(lancamento.id, base64, arquivo.type, arquivo.name);
      toast({ titulo: "Comprovante anexado", variante: "sucesso" });
      await recarregarEste();
      carregarHistorico();
      onMudou();
    } catch (err) {
      toast({
        titulo: "Não deu para anexar",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setOcupado(false);
    }
  }

  async function abrirComprovante() {
    if (!lancamento) return;
    try {
      // Um `<a href>` comum nao manda Authorization — os bytes vem por fetch
      // autenticado e viram blob: URL (mesmo padrao do EvidenciaGallery).
      const blob = await api.getBlob(`/financeiro/lancamentos/${lancamento.id}/comprovante`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      // Revoga depois de a aba abrir; revogar na hora mataria o link.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast({ titulo: "Não deu para abrir o comprovante", variante: "erro" });
    }
  }

  async function removerComprovante() {
    if (!lancamento) return;
    setOcupado(true);
    try {
      await financeiroApi.removerComprovante(lancamento.id);
      await recarregarEste();
      onMudou();
    } catch (err) {
      toast({
        titulo: "Não deu para remover",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    if (!lancamento) return;
    setOcupado(true);
    try {
      await financeiroApi.cancelar(lancamento.id, motivo.trim() || undefined);
      toast({ titulo: `Lançamento ${lancamento.numero} cancelado`, variante: "sucesso" });
      onMudou();
      onFechar();
    } catch (err) {
      toast({
        titulo: "Não deu para cancelar",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setOcupado(false);
    }
  }

  // So antes da PRIMEIRA abertura — dai em diante o dialogo permanece montado.
  if (!dados) return null;

  const podeMexer = dados.status === "pendente";

  return (
    <Dialog open={!!lancamento} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            #{dados.numero} · {dados.descricao}
          </DialogTitle>
          <DialogDescription>
            {dados.tipo === "receita" ? "A receber" : "A pagar"} ·{" "}
            <span className="font-mono font-semibold tabular-nums">{formatarMoeda(dados.valor)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Campo rotulo="Vencimento" valor={formatarDataIso(dados.vencimento)} />
            <Campo rotulo="Competência" valor={formatarCompetencia(dados.competencia)} />
            <Campo rotulo="Provedor" valor={dados.provedorNome ?? "—"} />
            <Campo rotulo="Categoria" valor={dados.categoriaNome ?? "—"} />
            <Campo rotulo="Nota / documento" valor={dados.numeroDocumento ?? "—"} />
            <Campo rotulo="Origem" valor={ORIGEM_ROTULO[dados.origem] + (dados.ehServico ? " · serviço" : "")} />
            {dados.pagoEm && <Campo rotulo="Pago em" valor={formatarDataIso(dados.pagoEm)} />}
            {dados.valorPago && (
              <Campo rotulo="Valor pago" valor={formatarMoeda(dados.valorPago)} />
            )}
            {dados.formaPagamento && (
              <Campo rotulo="Forma" valor={FORMA_PAGAMENTO_ROTULO[dados.formaPagamento]} />
            )}
          </dl>

          {dados.observacao && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{dados.observacao}</p>
          )}

          {/* --- comprovante --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Comprovante</h3>
            {dados.temComprovante ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={abrirComprovante}>
                  <FileText className="size-4" aria-hidden />
                  {dados.comprovanteNome ?? "Abrir comprovante"}
                </Button>
                <Button variant="ghost" size="sm" onClick={removerComprovante} disabled={ocupado}>
                  <Trash2 className="size-4" aria-hidden />
                  Remover
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  ref={inputArquivo}
                  type="file"
                  accept={MIMES_ACEITOS}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void enviarComprovante(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => inputArquivo.current?.click()}
                  disabled={ocupado}
                >
                  <Paperclip className="size-4" aria-hidden />
                  Anexar
                </Button>
                <span className="text-xs text-muted-foreground">PDF ou imagem, até 3MB.</span>
              </div>
            )}
          </section>

          {/* --- auditoria --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Histórico</h3>
            {eventos === null ? (
              <Skeleton className="h-20" />
            ) : eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem eventos.</p>
            ) : (
              <ol className="flex flex-col gap-2 border-l border-border pl-4">
                {eventos.map((ev) => (
                  <li key={ev.id} className="relative text-sm">
                    <span
                      className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-border"
                      aria-hidden
                    />
                    <span className="font-medium">{ROTULO_EVENTO[ev.tipo]}</span>
                    {ev.autorNome && <span className="text-muted-foreground"> por {ev.autorNome}</span>}
                    <span className="text-muted-foreground">
                      {" "}
                      · {rotuloDataHora(ev.criadoEm)}
                    </span>
                    {ev.detalhe && Object.keys(ev.detalhe).length > 0 && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {Object.entries(ev.detalhe)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* --- cancelamento --- */}
          {confirmandoCancelamento && (
            <section className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <Label htmlFor="motivo-cancelamento">Motivo do cancelamento (opcional)</Label>
              <Input
                id="motivo-cancelamento"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={200}
                placeholder="Lançado em duplicidade"
              />
              <p className="text-xs text-muted-foreground">
                O lançamento não é apagado — ele sai do fluxo e fica no histórico com quem cancelou.
              </p>
            </section>
          )}
        </div>

        <DialogFooter className={cn(podeMexer && "sm:justify-between")}>
          {podeMexer ? (
            <>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => onEditar(dados)}>
                  <Pencil className="size-4" aria-hidden />
                  Editar
                </Button>
                {confirmandoCancelamento ? (
                  <Button variant="destructive" onClick={cancelar} disabled={ocupado}>
                    Confirmar cancelamento
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmandoCancelamento(true)}>
                    <Ban className="size-4" aria-hidden />
                    Cancelar lançamento
                  </Button>
                )}
              </div>
              <Button variant="ghost" onClick={onFechar}>
                Fechar
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={onFechar}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  );
}
