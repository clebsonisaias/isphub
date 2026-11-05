import { useEffect, useState, type ReactNode } from "react";
import type { Olt, OnuAutorizada, OnuNaoAutorizada, OnuTemplate, Provedor, ProvisionarOnuInput } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { provedoresApi } from "@/lib/adminApi";
import { corSinal, rotuloSinal } from "@/lib/sinal";
import { fttxApi } from "@/lib/fttxApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { usePodeEditar } from "@/context/AuthContext";
import { AvisoSoVer } from "@/components/AvisoSoVer";
import { Router, Search } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function Pill({ ativo, children, onClick }: { ativo: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <Button variant={ativo ? "default" : "outline"} size="sm" onClick={onClick} className="rounded-full">
      {children}
    </Button>
  );
}

/**
 * Provisionar ONU (FTTX) — admin/gestor/provedor. Escolhe o provedor (cada um
 * tem o seu SGP, com as suas OLTs), a OLT, e então autoriza/desautoriza ONUs.
 * Web é cliente da API — a autorização é escrita de rede real (muda a ONU do
 * cliente na OLT); só valida contra um SGP de provedor com FTTX habilitado.
 */
export function ProvisionamentoPage() {
  const { toast } = useToast();
  // Supervisor com o provisionamento so em "ver": lista OLTs e ONUs, sem autorizar nem remover.
  const podeEditar = usePodeEditar("provisionamento");
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [provedorId, setProvedorId] = useState<string | null>(null);
  const [olts, setOlts] = useState<Olt[]>([]);
  const [oltsCarregando, setOltsCarregando] = useState(false);
  const [olt, setOlt] = useState<Olt | null>(null);
  const [aba, setAba] = useState<"nao" | "aut">("nao");
  const [onusNao, setOnusNao] = useState<OnuNaoAutorizada[]>([]);
  const [onusAut, setOnusAut] = useState<OnuAutorizada[]>([]);
  const [onusCarregando, setOnusCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<OnuNaoAutorizada | null>(null);

  useEffect(() => {
    provedoresApi
      .listar()
      .then(setProvedores)
      .catch((e) => toast({ titulo: "Erro ao carregar provedores", descricao: mensagem(e), variante: "erro" }));
  }, [toast]);

  // Trocar de provedor zera OLT/listas e recarrega as OLTs daquele SGP.
  useEffect(() => {
    setOlt(null);
    setOlts([]);
    setOnusNao([]);
    setOnusAut([]);
    if (!provedorId) return;
    setOltsCarregando(true);
    fttxApi
      .olts(provedorId)
      .then(setOlts)
      .catch((e) => toast({ titulo: "Erro ao listar OLTs", descricao: mensagem(e), variante: "erro" }))
      .finally(() => setOltsCarregando(false));
  }, [provedorId, toast]);

  async function carregarNao(pid: string, oltId: string) {
    setOnusCarregando(true);
    try {
      setOnusNao(await fttxApi.onusNaoAutorizadas(pid, oltId));
    } catch (e) {
      toast({ titulo: "Erro ao listar ONUs", descricao: mensagem(e), variante: "erro" });
    } finally {
      setOnusCarregando(false);
    }
  }

  async function carregarAut(pid: string, oltId: string, contrato?: string) {
    setOnusCarregando(true);
    try {
      setOnusAut(await fttxApi.onusAutorizadas(pid, oltId, contrato));
    } catch (e) {
      toast({ titulo: "Erro ao listar ONUs", descricao: mensagem(e), variante: "erro" });
    } finally {
      setOnusCarregando(false);
    }
  }

  function selecionarOlt(o: Olt) {
    setOlt(o);
    setAba("nao");
    setBusca("");
    if (provedorId) void carregarNao(provedorId, o.id);
  }

  function trocarAba(v: "nao" | "aut") {
    setAba(v);
    if (!provedorId || !olt) return;
    if (v === "nao") void carregarNao(provedorId, olt.id);
    else void carregarAut(provedorId, olt.id, busca.trim() || undefined);
  }

  function buscar() {
    if (provedorId && olt) void carregarAut(provedorId, olt.id, busca.trim() || undefined);
  }

  async function desautorizar(onu: OnuAutorizada) {
    if (!provedorId || !olt) return;
    if (!window.confirm(`Remover a ONU ${onu.serial}${onu.clienteNome ? ` (${onu.clienteNome})` : ""}? Isso derruba o serviço do cliente.`)) return;
    try {
      await fttxApi.desautorizar(provedorId, onu.id);
      toast({ titulo: "ONU desautorizada", variante: "sucesso" });
      void carregarAut(provedorId, olt.id, busca.trim() || undefined);
    } catch (e) {
      toast({ titulo: "Não foi possível desautorizar", descricao: mensagem(e), variante: "erro" });
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Router className="size-6 text-primary" />
          Provisionar ONU
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Escolha o provedor e a OLT para autorizar ou remover ONUs. Autorizar provisiona a ONU no SGP do provedor — muda o
          serviço do cliente na rede.
        </p>
        {podeEditar ? null : (
          <div className="mt-3">
            <AvisoSoVer />
          </div>
        )}
      </div>

      {/* Provedor */}
      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provedor</p>
        <div className="flex flex-wrap gap-2">
          {provedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum provedor disponível.</p>
          ) : (
            provedores.map((p) => (
              <Pill key={p.id} ativo={p.id === provedorId} onClick={() => setProvedorId(p.id)}>
                {p.nome}
              </Pill>
            ))
          )}
        </div>
      </div>

      {/* OLTs */}
      {provedorId && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">OLTs</p>
          {oltsCarregando ? (
            <p className="text-sm text-muted-foreground">Carregando OLTs…</p>
          ) : olts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma OLT neste provedor (o SGP pode não ter FTTX habilitado).</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {olts.map((o) => (
                <Pill key={o.id} ativo={o.id === olt?.id} onClick={() => selecionarOlt(o)}>
                  {o.nome}
                  {o.fabricante ? <span className="ml-1 text-xs opacity-70">· {o.fabricante}</span> : null}
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ONUs da OLT */}
      {olt && provedorId && (
        <Tabs value={aba} onValueChange={(v) => trocarAba(v as "nao" | "aut")}>
          <TabsList>
            <TabsTrigger value="nao">Não autorizadas</TabsTrigger>
            <TabsTrigger value="aut">Autorizadas</TabsTrigger>
          </TabsList>

          <TabsContent value="nao">
            {onusCarregando ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : onusNao.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma ONU aguardando autorização.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {onusNao.map((onu) => (
                  <Card key={onu.id}>
                    <CardContent className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold tracking-wide">{onu.serial}</p>
                        <p className="text-xs text-muted-foreground">
                          {[onu.slot != null ? `slot ${onu.slot}` : null, onu.pon != null ? `pon ${onu.pon}` : null, onu.tipo]
                            .filter(Boolean)
                            .join(" · ") || "sem detalhes"}
                        </p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold ${corSinal(onu.sinalRxDbm)}`}>{rotuloSinal(onu.sinalRxDbm)}</span>
                      {podeEditar ? (
                        <Button size="sm" onClick={() => setAlvo(onu)}>
                          Autorizar
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="aut">
            <div className="mb-3 flex gap-2">
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por contrato ou CPF/CNPJ"
                onKeyDown={(e) => {
                  if (e.key === "Enter") buscar();
                }}
              />
              <Button variant="outline" onClick={buscar}>
                <Search className="size-4" />
                Buscar
              </Button>
            </div>
            {onusCarregando ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : onusAut.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma ONU autorizada encontrada.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {onusAut.map((onu) => (
                  <Card key={onu.id}>
                    <CardContent className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold tracking-wide">{onu.serial}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[onu.clienteNome, onu.contrato ? `contrato ${onu.contrato}` : null].filter(Boolean).join(" · ") ||
                            "sem cliente"}
                        </p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold ${corSinal(onu.sinalRxDbm)}`}>{rotuloSinal(onu.sinalRxDbm)}</span>
                      {podeEditar ? (
                        <Button variant="destructive" size="sm" onClick={() => desautorizar(onu)}>
                          Remover
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {provedorId && olt && (
        <AutorizarOnuDialog
          provedorId={provedorId}
          oltId={olt.id}
          onu={alvo}
          onClose={() => setAlvo(null)}
          onDone={() => carregarNao(provedorId, olt.id)}
        />
      )}
    </AppShell>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function AutorizarOnuDialog({
  provedorId,
  oltId,
  onu,
  onClose,
  onDone,
}: {
  provedorId: string;
  oltId: string;
  onu: OnuNaoAutorizada | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [serial, setSerial] = useState("");
  const [slot, setSlot] = useState("");
  const [pon, setPon] = useState("");
  const [onutype, setOnutype] = useState("");
  const [mode, setMode] = useState<1 | 2>(2);
  const [vlan, setVlan] = useState("");
  const [pppoeLogin, setPppoeLogin] = useState("");
  const [pppoeSenha, setPppoeSenha] = useState("");
  const [service, setService] = useState("");
  const [contrato, setContrato] = useState("");
  const [ident, setIdent] = useState("");
  const [descricao, setDescricao] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<OnuTemplate[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!onu) return;
    setSerial(onu.serial);
    setSlot(onu.slot ?? "");
    setPon(onu.pon ?? "");
    setOnutype(onu.tipo ?? "");
    setMode(2);
    setVlan(onu.vlan != null ? String(onu.vlan) : "");
    setPppoeLogin("");
    setPppoeSenha("");
    setService("");
    setContrato("");
    setIdent("");
    setDescricao("");
    setTemplateId(null);
    fttxApi
      .templates(provedorId, oltId)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [onu, provedorId, oltId]);

  async function enviar() {
    if (!serial.trim() || !slot.trim() || !pon.trim()) {
      toast({ titulo: "Faltam dados", descricao: "Serial, slot e pon são obrigatórios.", variante: "erro" });
      return;
    }
    const dados: ProvisionarOnuInput = {
      serial: serial.trim(),
      slot: slot.trim(),
      pon: pon.trim(),
      // opcional: o SGP detecta o modelo pelo SN quando vazio.
      onutype: onutype.trim() || undefined,
      mode,
      vlan: vlan.trim() ? Number(vlan.trim()) : undefined,
      contrato: contrato.trim() || undefined,
      service: service.trim() || undefined,
      pppoeLogin: mode === 2 && pppoeLogin.trim() ? pppoeLogin.trim() : undefined,
      pppoeSenha: mode === 2 && pppoeSenha ? pppoeSenha : undefined,
      onutemplate: templateId ?? undefined,
      descricao: descricao.trim() || undefined,
      ident: ident.trim() || undefined,
    };
    setEnviando(true);
    try {
      const r = await fttxApi.autorizar(provedorId, oltId, dados);
      toast({ titulo: "ONU autorizada", descricao: r.mensagem ?? undefined, variante: "sucesso" });
      onDone();
      onClose();
    } catch (e) {
      toast({ titulo: "Não foi possível autorizar", descricao: mensagem(e), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={!!onu}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Autorizar ONU</DialogTitle>
          <DialogDescription>Provisiona a ONU no SGP do provedor — muda o serviço do cliente na OLT.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Campo label="Serial (SN)">
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Slot">
              <Input value={slot} onChange={(e) => setSlot(e.target.value)} inputMode="numeric" />
            </Campo>
            <Campo label="Pon">
              <Input value={pon} onChange={(e) => setPon(e.target.value)} inputMode="numeric" />
            </Campo>
          </div>
          <Campo label="Tipo de ONU (opcional — o SGP detecta pelo SN)">
            <Input value={onutype} onChange={(e) => setOnutype(e.target.value)} placeholder="Ex.: HG8310" />
          </Campo>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modo</span>
            <div className="flex gap-2">
              <Button type="button" variant={mode === 2 ? "default" : "outline"} size="sm" onClick={() => setMode(2)}>
                PPPoE
              </Button>
              <Button type="button" variant={mode === 1 ? "default" : "outline"} size="sm" onClick={() => setMode(1)}>
                Bridge
              </Button>
            </div>
          </div>

          {mode === 2 && (
            /* Empilhado no celular: ao contrario de Slot/Porta e VLAN/Contrato
               (numeros curtos), login e senha de PPPoE sao textos longos —
               em ~160px de largura o valor rola dentro do campo e o tecnico
               digita sem ver o que digitou. */
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Login PPPoE">
                <Input value={pppoeLogin} onChange={(e) => setPppoeLogin(e.target.value)} autoComplete="off" />
              </Campo>
              <Campo label="Senha PPPoE">
                <Input value={pppoeSenha} onChange={(e) => setPppoeSenha(e.target.value)} type="password" autoComplete="new-password" />
              </Campo>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Campo label="VLAN">
              <Input value={vlan} onChange={(e) => setVlan(e.target.value)} inputMode="numeric" placeholder="opcional" />
            </Campo>
            <Campo label="Contrato">
              <Input value={contrato} onChange={(e) => setContrato(e.target.value)} inputMode="numeric" placeholder="opcional" />
            </Campo>
          </div>
          <Campo label="Serviço (login/ID do cliente)">
            <Input value={service} onChange={(e) => setService(e.target.value)} autoComplete="off" placeholder="opcional" />
          </Campo>
          <Campo label="Identificação (CTO)">
            <Input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="Ex.: CTO-05 P3" />
          </Campo>
          <Campo label="Descrição">
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="opcional" />
          </Campo>

          {templates.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Template (opcional)</span>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={t.id === templateId ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setTemplateId(t.id === templateId ? null : t.id)}
                  >
                    {t.nome}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando…" : "Autorizar ONU"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
