import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, useMap } from "react-leaflet";
import { ArrowLeft, Check, CheckCircle2, Copy, Crosshair, Loader2, MapPin, MessageCircle, RotateCcw, Search, TriangleAlert, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ROTULO_TURNO, UserRole, type TurnoAgenda } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { CamadaOsm } from "@/components/mapa/base";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { Select } from "@/components/ui/select";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { rotuloDiaAgenda } from "@/lib/agendaApi";
import {
  apagarRascunho,
  errosCliente,
  faltando,
  lerCobertura,
  mesclarEndereco,
  type EnderecoMapa,
  lerRascunho,
  mascararCelular,
  mascararCep,
  mascararData,
  mascararDocumento,
  salvarRascunho,
  soDigitos,
} from "@/lib/preCadastro";
import { preCadastroApi, type BuscaOs, type CoberturaResposta, type PlanoZona, type PreCadastro } from "@/lib/preCadastroApi";
import { integracoesApi } from "@/lib/integracoesApi";
import { cn } from "@/lib/utils";

/**
 * PRE-CADASTRO EM CAMPO — o vendedor no local do cliente, celular na mao, sol
 * na tela. Cadastra (o SGP abre a OS de instalacao junto) e agenda na hora.
 *
 * Uma coluna, uma etapa por vez, o botao principal sempre no alcance do polegar.
 * O que o cliente ja ditou fica salvo no aparelho a cada tecla: sinal que cai
 * ou app que fecha nao fazem o vendedor perguntar tudo de novo.
 */

const ETAPAS = ["Local", "Plano", "Cliente", "Revisar", "Agendar"] as const;
/** OS de instalacao: 20 consultas de 3 s = 1 minuto, depois desiste com explicacao. */
const TENTATIVAS_OS = 20;

interface Cliente {
  nome: string;
  documento: string;
  nascimento: string;
  celular: string;
  email: string;
  logradouro: string;
  numero: string;
  complemento: string;
  referencia: string;
  bairro: string;
  cidade: string;
  cep: string;
}

interface Rascunho {
  etapa: number;
  ponto: { lat: number; lng: number } | null;
  cobertura: CoberturaResposta | null;
  planoId: number | null;
  vencimentoDia: number | null;
  cliente: Cliente;
  /** O que o mapa preencheu no endereco (para marcar "confira" e trocar ao mover o pino). */
  autoEndereco: Partial<EnderecoMapa> | null;
  /** Gestao (admin/gestor) escolhe de qual provedor e a venda; vendedor ja e preso ao dele. */
  provedorId: string | null;
}

const CLIENTE_VAZIO: Cliente = {
  nome: "",
  documento: "",
  nascimento: "",
  celular: "",
  email: "",
  logradouro: "",
  numero: "",
  complemento: "",
  referencia: "",
  bairro: "",
  cidade: "",
  cep: "",
};
const RASCUNHO_VAZIO: Rascunho = { etapa: 0, ponto: null, cobertura: null, planoId: null, vencimentoDia: null, cliente: CLIENTE_VAZIO, autoEndereco: null, provedorId: null };

const mensagem = (err: unknown) => (err instanceof ApiError ? err.message : "Sem conexão com o servidor. Confira o sinal.");
const reais = (v: number | null) => (v == null ? null : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export function PreCadastroPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [r, setR] = useState<Rascunho>(() => ({ ...RASCUNHO_VAZIO, ...lerRascunho<Rascunho>() }));
  const [enviado, setEnviado] = useState<PreCadastro | null>(null);
  // Gestao (admin/gestor) vende em nome de um provedor; o vendedor ja e preso ao dele.
  const { usuario } = useAuth();
  const gestao = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;
  const provedores = useQuery({ queryKey: ["provedores"], queryFn: () => provedoresApi.listar(), enabled: gestao });

  // Rascunho a cada mudanca — e so do que ainda nao foi enviado.
  useEffect(() => {
    if (!enviado) salvarRascunho(r);
  }, [r, enviado]);

  const set = useCallback((patch: Partial<Rascunho>) => setR((v) => ({ ...v, ...patch })), []);
  const setCliente = useCallback((patch: Partial<Cliente>) => setR((v) => ({ ...v, cliente: { ...v.cliente, ...patch } })), []);
  const irPara = (etapa: number) => {
    set({ etapa });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const plano = r.cobertura?.planos.find((p) => p.plano_id === r.planoId) ?? null;
  const etapa = enviado ? 4 : Math.min(r.etapa, 3);

  function recomecar() {
    apagarRascunho();
    setEnviado(null);
    setR(RASCUNHO_VAZIO);
    window.scrollTo({ top: 0 });
  }

  function retomar(pc: PreCadastro) {
    setEnviado(pc);
    window.scrollTo({ top: 0 });
  }

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <header className="flex flex-col gap-1">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Venda em campo</p>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Pré-cadastro</h1>
          </header>

          {gestao && !enviado && (
            <div className="flex max-w-sm flex-col gap-1.5">
              <Label htmlFor="pc-provedor" className="text-sm font-semibold">
                Provedor da venda
              </Label>
              <Select
                id="pc-provedor"
                value={r.provedorId ?? ""}
                onChange={(e) => setR({ ...RASCUNHO_VAZIO, provedorId: e.target.value || null })}
                className="h-12"
              >
                <option value="">Escolha o provedor…</option>
                {(provedores.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <Trilha atual={etapa} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="flex min-w-0 flex-col gap-5" aria-live="polite">
              {gestao && !r.provedorId && !enviado ? (
                <p className="text-sm text-muted-foreground">Escolha o provedor para começar o pré-cadastro.</p>
              ) : etapa === 0 && <EtapaLocal r={r} set={set} onAvancar={() => irPara(1)} onRetomar={retomar} />}
              {etapa === 1 && r.cobertura && (
                <EtapaPlano r={r} set={set} onVoltar={() => irPara(0)} onAvancar={() => irPara(2)} />
              )}
              {etapa === 2 && <EtapaCliente r={r} setCliente={setCliente} onVoltar={() => irPara(1)} onAvancar={() => irPara(3)} />}
              {etapa === 3 && plano && (
                <EtapaRevisar
                  r={r}
                  plano={plano}
                  onEditar={irPara}
                  onEnviado={(pc) => {
                    apagarRascunho();
                    setEnviado(pc);
                    void queryClient.invalidateQueries({ queryKey: ["pre-cadastro", "lista"] });
                    toast({ titulo: "Pré-cadastro enviado", descricao: pc.protocolo ? `Protocolo ${pc.protocolo}` : undefined, variante: "sucesso" });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}
              {etapa === 4 && enviado && <EtapaAgendar pc={enviado} onNovo={recomecar} />}
            </section>

            <aside className="hidden flex-col gap-4 lg:flex">
              <div className="sticky top-24 flex flex-col gap-4">
                {r.ponto && !enviado && <MiniMapa ponto={r.ponto} />}
                <Resumo r={r} plano={plano} enviado={enviado} />
              </div>
            </aside>
          </div>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Moldura
// ---------------------------------------------------------------------------

function Trilha({ atual }: { atual: number }) {
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Etapas do pré-cadastro">
      {ETAPAS.map((nome, i) => {
        const feita = i < atual;
        const agora = i === atual;
        return (
          <li key={nome} aria-current={agora ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-colors", feita ? "bg-primary" : agora ? "bg-primary/70" : "bg-border")} />
            <span className={cn("truncate text-xs font-semibold", agora ? "text-foreground" : "text-muted-foreground")}>
              <span className="font-mono">{i + 1}</span> {nome}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Barra do botao principal: no celular gruda acima da navegacao do rodape. */
function BarraAcao({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-1 flex gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md lg:static lg:mx-0 lg:border-t-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
      {children}
    </div>
  );
}

function Titulo({ n, children, sub }: { n: number; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-display text-xl font-bold tracking-tight">
        <span className="mr-2 font-mono text-primary">{String(n).padStart(2, "0")}</span>
        {children}
      </h2>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Campo(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  erro?: string | null;
  dica?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  autoComplete?: string;
  placeholder?: string;
  className?: string;
  opcional?: boolean;
}) {
  const [tocado, setTocado] = useState(false);
  const erro = tocado && props.value ? props.erro : null;
  return (
    <div className={cn("flex flex-col gap-1.5", props.className)}>
      <Label htmlFor={props.id} className="text-sm font-semibold">
        {props.label}
        {props.opcional && <span className="ml-1 font-normal text-muted-foreground">(opcional)</span>}
      </Label>
      <input
        id={props.id}
        value={props.value}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        aria-invalid={!!erro}
        aria-describedby={erro || props.dica ? `${props.id}-msg` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={() => setTocado(true)}
        className={cn(
          "h-12 w-full rounded-lg border bg-card px-3.5 text-base outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
          erro ? "border-destructive" : "border-input",
        )}
      />
      {(erro || props.dica) && (
        <span id={`${props.id}-msg`} className={cn("text-xs", erro ? "text-destructive" : "text-muted-foreground")}>
          {erro ?? props.dica}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Local
// ---------------------------------------------------------------------------

function EtapaLocal({
  r,
  set,
  onAvancar,
  onRetomar,
}: {
  r: Rascunho;
  set: (p: Partial<Rascunho>) => void;
  onAvancar: () => void;
  onRetomar: (pc: PreCadastro) => void;
}) {
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState<"gps" | "busca" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function consultar(q: { lat?: number; lng?: number; cep?: string; endereco?: string }, ponto: { lat: number; lng: number } | null) {
    setErro(null);
    try {
      const c = await preCadastroApi.cobertura(q, r.provedorId);
      const p = ponto ?? (c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null);
      // Sem cobertura nao adianta nada no formulario: aquele endereco nao e o da venda.
      if (!c.tratarComoCoberto) {
        set({ cobertura: c, ponto: p, planoId: null });
        return;
      }
      // O vendedor esta na casa do cliente: o endereco do ponto ja vem no cadastro,
      // para ele so conferir. O que ele mesmo digitou nunca e trocado.
      const { endereco, auto } = mesclarEndereco(r.cliente, r.autoEndereco, {
        logradouro: c.local?.logradouro,
        bairro: c.local?.bairro,
        cidade: c.local?.cidade ?? c.cidade,
        cep: c.local?.cep ?? q.cep,
      });
      set({
        cobertura: c,
        ponto: p,
        planoId: c.planos.some((x) => x.plano_id === r.planoId) ? r.planoId : null,
        cliente: { ...r.cliente, ...endereco },
        autoEndereco: { ...r.autoEndereco, ...auto },
      });
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setCarregando(null);
    }
  }

  function usarGps() {
    if (!navigator.geolocation) {
      setErro("Este aparelho não informa a localização. Use o CEP ou o endereço.");
      return;
    }
    setCarregando("gps");
    setErro(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ponto = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        void consultar(ponto, ponto);
      },
      (e) => {
        setCarregando(null);
        setErro(
          e.code === e.PERMISSION_DENIED
            ? "A localização foi bloqueada. Libere nas permissões do navegador, ou use o CEP."
            : "Não consegui o GPS agora. Tente ao ar livre, ou use o CEP.",
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  function buscar() {
    const termo = busca.trim();
    if (!termo) return;
    setCarregando("busca");
    const cep = soDigitos(termo);
    void consultar(cep.length === 8 && cep.length === termo.replace(/[\s-]/g, "").length ? { cep } : { endereco: termo }, null);
  }

  const leitura = r.cobertura ? lerCobertura(r.cobertura) : null;

  return (
    <>
      <Titulo n={1} sub="Confira se o endereço do cliente tem cobertura antes de começar.">
        Onde é a instalação?
      </Titulo>

      <Button type="button" variant="brand" className="h-14 text-base" onClick={usarGps} disabled={carregando !== null}>
        {carregando === "gps" ? <Loader2 className="animate-spin" /> : <Crosshair />}
        {carregando === "gps" ? "Pegando a localização…" : "Estou no local do cliente"}
      </Button>

      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou busque
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          buscar();
        }}
      >
        <label htmlFor="busca-local" className="sr-only">
          CEP ou endereço
        </label>
        <input
          id="busca-local"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="CEP ou rua, número, bairro"
          autoComplete="street-address"
          className="h-12 min-w-0 flex-1 rounded-lg border border-input bg-card px-3.5 text-base outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <Button type="submit" variant="outline" className="h-12 px-4" disabled={carregando !== null || !busca.trim()} aria-label="Buscar cobertura">
          {carregando === "busca" ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </form>

      {erro && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      )}

      {leitura && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border-2 p-4",
            leitura.tom === "ok" && "border-success/50 bg-success/10",
            leitura.tom === "atencao" && "border-warning/50 bg-warning/10",
            leitura.tom === "nao" && "border-destructive/50 bg-destructive/10",
          )}
        >
          {leitura.tom === "ok" ? (
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" />
          ) : leitura.tom === "atencao" ? (
            <TriangleAlert className="mt-0.5 size-6 shrink-0 text-warning" />
          ) : (
            <XCircle className="mt-0.5 size-6 shrink-0 text-destructive" />
          )}
          <div className="min-w-0">
            <p className="font-display text-lg font-bold">{leitura.titulo}</p>
            {leitura.detalhe && <p className="text-sm">{leitura.detalhe}</p>}
            {leitura.pode && r.cobertura && r.cobertura.planos.length === 0 && (
              <p className="mt-1 text-sm text-destructive">Nenhum plano cadastrado para esta área no AtendAI.</p>
            )}
          </div>
        </div>
      )}

      {leitura?.pode && (r.cliente.logradouro || r.cliente.cep) && (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Endereço encontrado no mapa</p>
          <p className="font-semibold">
            {[r.cliente.logradouro, r.cliente.bairro].filter(Boolean).join(" · ") || "Rua não identificada"}
          </p>
          <p className="text-sm text-muted-foreground">
            {[r.cliente.cidade, r.cliente.cep && `CEP ${r.cliente.cep}`].filter(Boolean).join(" · ")}
          </p>
          {!r.cliente.cep && !!r.cobertura?.local?.candidatosCep?.length && (
            <p className="text-sm font-semibold text-warning">Esta rua tem mais de um CEP. Você escolhe o certo na etapa 3.</p>
          )}
          <p className="text-sm">Confira com o cliente. Na etapa 3 você corrige o que o mapa errou e põe o número da casa.</p>
        </div>
      )}

      {r.ponto && (
        <div className="lg:hidden">
          <MiniMapa
            ponto={r.ponto}
            onMover={(p) => {
              set({ ponto: p });
              setCarregando("gps");
              void consultar(p, p);
            }}
          />
        </div>
      )}

      {leitura?.pode && r.cobertura && r.cobertura.planos.length > 0 && (
        <BarraAcao>
          <Button type="button" variant="brand" className="h-13 flex-1 text-base" onClick={onAvancar}>
            Escolher o plano
          </Button>
        </BarraAcao>
      )}

      <PendentesDeAgenda onRetomar={onRetomar} />
    </>
  );
}

/** Pino que o vendedor arrasta quando o GPS cai na casa do vizinho. */
const PINO = L.divIcon({
  className: "",
  html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--primary);border:3px solid #fff;box-shadow:0 4px 12px rgb(0 0 0 / .35)"></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

function Centralizar({ ponto }: { ponto: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([ponto.lat, ponto.lng], Math.max(map.getZoom(), 17));
  }, [ponto.lat, ponto.lng, map]);
  return null;
}

function MiniMapa({ ponto, onMover }: { ponto: { lat: number; lng: number }; onMover?: (p: { lat: number; lng: number }) => void }) {
  const eventos = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        onMover?.({ lat: ll.lat, lng: ll.lng });
      },
    }),
    [onMover],
  );
  return (
    <figure className="flex flex-col gap-1.5">
      {/* `isolate`: as camadas do Leaflet (z-index 400+) ficam aqui dentro, sem cobrir a barra do botão nem a navegação. */}
      <div className="isolate h-56 overflow-hidden rounded-xl border border-border lg:h-64">
        <MapContainer center={[ponto.lat, ponto.lng]} zoom={17} scrollWheelZoom={false} className="size-full">
          <CamadaOsm />
          <Centralizar ponto={ponto} />
          <Marker position={[ponto.lat, ponto.lng]} icon={PINO} draggable={!!onMover} eventHandlers={eventos} />
        </MapContainer>
      </div>
      {onMover && (
        <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" /> Arraste o pino até a casa do cliente para conferir de novo.
        </figcaption>
      )}
    </figure>
  );
}

/** Cadastros enviados que ainda nao sairam agendados — retomar sem recomecar. */
function PendentesDeAgenda({ onRetomar }: { onRetomar: (pc: PreCadastro) => void }) {
  const lista = useQuery({ queryKey: ["pre-cadastro", "lista"], queryFn: () => preCadastroApi.listar() });
  const pendentes = (lista.data ?? []).filter((p) => p.status !== "agendado").slice(0, 5);
  if (pendentes.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enviados sem visita marcada</p>
      <ul className="flex flex-col gap-2">
        {pendentes.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onRetomar(p)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2 text-left hover:bg-secondary"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{p.clienteNome}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.protocolo ? `Protocolo ${p.protocolo}` : "Sem protocolo"} · {new Date(p.criadoEm).toLocaleDateString("pt-BR")}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-primary">Agendar</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Plano e vencimento
// ---------------------------------------------------------------------------

function EtapaPlano({ r, set, onVoltar, onAvancar }: { r: Rascunho; set: (p: Partial<Rascunho>) => void; onVoltar: () => void; onAvancar: () => void }) {
  const venc = useQuery({
    queryKey: ["pre-cadastro", "vencimentos", r.provedorId],
    queryFn: () => preCadastroApi.vencimentos(r.provedorId),
    staleTime: 10 * 60_000,
  });
  const planos = (r.cobertura?.planos ?? []).filter((p): p is PlanoZona & { plano_id: number } => p.plano_id != null);

  return (
    <>
      <Titulo n={2} sub={r.cobertura?.zona?.nome ? `Planos de ${r.cobertura.zona.nome}` : undefined}>
        Plano e vencimento
      </Titulo>

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Plano">
        {planos.map((p) => {
          const ativo = r.planoId === p.plano_id;
          return (
            <button
              key={p.plano_id}
              type="button"
              role="radio"
              aria-checked={ativo}
              aria-label={[p.nome, reais(p.valor) ? `${reais(p.valor)} por mês` : null].filter(Boolean).join(", ")}
              onClick={() => set({ planoId: p.plano_id })}
              className={cn(
                "relative flex min-h-28 flex-col items-start gap-1 rounded-xl p-4 text-left transition-colors",
                ativo ? "border-2 border-primary bg-primary/10" : "border border-border bg-card hover:bg-secondary",
              )}
            >
              {p.destaque && (
                <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-primary-foreground">
                  Destaque
                </span>
              )}
              <span className="font-display text-3xl font-extrabold leading-none tracking-tight">
                {p.velocidade ?? "—"}
                <span className="ml-1 text-base font-semibold text-muted-foreground">{p.unidade}</span>
              </span>
              <span className="text-sm font-semibold">{p.nome}</span>
              {reais(p.valor) && <span className="font-mono text-lg font-semibold text-primary">{reais(p.valor)}/mês</span>}
              {p.beneficios.length > 0 && <span className="text-xs text-muted-foreground">{p.beneficios.join(" · ")}</span>}
              {ativo && <Check className="absolute bottom-3 right-3 size-5 text-primary" />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Dia do vencimento</p>
        {venc.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando os dias do SGP…</p>
        ) : venc.isError ? (
          <p className="text-sm text-destructive">
            {mensagem(venc.error)}{" "}
            <button type="button" className="font-semibold underline" onClick={() => void venc.refetch()}>
              Tentar de novo
            </button>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dia do vencimento">
            {venc.data.dias.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={r.vencimentoDia === d}
                onClick={() => set({ vencimentoDia: d })}
                className={cn(
                  "h-12 min-w-14 rounded-lg px-3 font-mono text-lg font-semibold transition-colors",
                  r.vencimentoDia === d ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-secondary",
                )}
              >
                {String(d).padStart(2, "0")}
              </button>
            ))}
          </div>
        )}
      </div>

      <BarraAcao>
        <Button type="button" variant="outline" className="h-13 px-4" onClick={onVoltar} aria-label="Voltar">
          <ArrowLeft />
        </Button>
        <Button type="button" variant="brand" className="h-13 flex-1 text-base" disabled={!r.planoId || !r.vencimentoDia} onClick={onAvancar}>
          Dados do cliente
        </Button>
      </BarraAcao>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Cliente
// ---------------------------------------------------------------------------

function EtapaCliente({ r, setCliente, onVoltar, onAvancar }: { r: Rascunho; setCliente: (p: Partial<Cliente>) => void; onVoltar: () => void; onAvancar: () => void }) {
  const c = r.cliente;
  const erros = errosCliente(c);
  const pj = soDigitos(c.documento).length === 14;
  const falta = faltando(erros);
  const candidatosCep = r.cobertura?.local?.candidatosCep ?? [];
  const [buscandoCep, setBuscandoCep] = useState(false);

  async function handleCepChange(v: string) {
    const formatado = mascararCep(v);
    setCliente({ cep: formatado });
    const limpo = soDigitos(v);
    if (limpo.length === 8) {
      setBuscandoCep(true);
      try {
        const res = await integracoesApi.consultarCep(limpo);
        if (res?.endereco) {
          setCliente({
            cep: formatado,
            logradouro: c.logradouro || res.endereco.logradouro,
            bairro: c.bairro || res.endereco.bairro,
            cidade: c.cidade || res.endereco.cidade,
          });
        }
      } finally {
        setBuscandoCep(false);
      }
    }
  }

  // Campo ainda com o valor que o mapa pos: a vendedora so confere.
  const doMapa = (k: keyof EnderecoMapa) => (c[k] && c[k] === r.autoEndereco?.[k] ? "Veio do mapa, confira." : undefined);

  return (
    <>
      <Titulo n={3} sub="Os dados vão direto para o cadastro no SGP.">
        Dados do cliente
      </Titulo>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Titular</legend>
        <Campo id="pc-nome" label={pj ? "Razão social" : "Nome completo"} value={c.nome} onChange={(v) => setCliente({ nome: v })} erro={erros.nome} autoComplete="name" className="sm:col-span-2" />
        <Campo
          id="pc-doc"
          label="CPF ou CNPJ"
          value={c.documento}
          onChange={(v) => setCliente({ documento: mascararDocumento(v) })}
          erro={erros.documento}
          inputMode="numeric"
          autoComplete="off"
        />
        {!pj && (
          <Campo
            id="pc-nasc"
            label="Nascimento"
            value={c.nascimento}
            onChange={(v) => setCliente({ nascimento: mascararData(v) })}
            erro={erros.nascimento}
            inputMode="numeric"
            autoComplete="bday"
            placeholder="dd/mm/aaaa"
          />
        )}
        <Campo id="pc-cel" label="Celular (WhatsApp)" value={c.celular} onChange={(v) => setCliente({ celular: mascararCelular(v) })} erro={erros.celular} inputMode="tel" autoComplete="tel-national" />
        <Campo id="pc-email" label="E-mail" value={c.email} onChange={(v) => setCliente({ email: v })} erro={erros.email} inputMode="email" autoComplete="email" />
      </fieldset>

      <fieldset className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-4">
        <legend className="mb-4 w-full border-t border-border pt-5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Endereço da instalação</legend>
        <Campo id="pc-rua" label="Rua" value={c.logradouro} onChange={(v) => setCliente({ logradouro: v })} erro={erros.logradouro} dica={doMapa("logradouro")} autoComplete="address-line1" />
        <Campo id="pc-num" label="Nº" value={c.numero} onChange={(v) => setCliente({ numero: v })} inputMode="numeric" placeholder="S/N" />
        <Campo id="pc-bairro" label="Bairro" value={c.bairro} onChange={(v) => setCliente({ bairro: v })} erro={erros.bairro} dica={doMapa("bairro")} className="col-span-2 sm:col-span-1" />
        <Campo id="pc-cep" label="CEP" value={c.cep} onChange={handleCepChange} erro={erros.cep} dica={buscandoCep ? "Buscando endereço pelo CEP…" : doMapa("cep")} inputMode="numeric" autoComplete="postal-code" className="col-span-2 sm:col-span-1" />
        {candidatosCep.length > 0 && soDigitos(c.cep).length !== 8 && (
          <div className="col-span-2 flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
            <p className="text-sm font-semibold">Esta rua tem mais de um CEP. Toque no do cliente:</p>
            <div className="flex flex-wrap gap-2">
              {candidatosCep.map((x) => (
                <button
                  key={x.cep}
                  type="button"
                  onClick={() => handleCepChange(x.cep)}
                  className="flex min-h-12 flex-col items-start justify-center rounded-lg border border-border bg-card px-3 text-left hover:bg-secondary"
                >
                  <span className="font-mono font-semibold">{mascararCep(x.cep)}</span>
                  {x.bairro && <span className="text-xs text-muted-foreground">{x.bairro}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <Campo id="pc-cidade" label="Cidade" value={c.cidade} onChange={(v) => setCliente({ cidade: v })} erro={erros.cidade} dica={doMapa("cidade")} className="col-span-2" />
        <Campo id="pc-comp" label="Complemento" value={c.complemento} onChange={(v) => setCliente({ complemento: v })} placeholder="Casa B, apto 102" opcional className="col-span-2" />
        <Campo id="pc-ref" label="Ponto de referência" value={c.referencia} onChange={(v) => setCliente({ referencia: v })} placeholder="Portão azul, ao lado da padaria" opcional className="col-span-2" />
      </fieldset>

      {falta && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Falta preencher: <span className="font-semibold text-foreground">{falta}</span>
        </p>
      )}
      <BarraAcao>
        <Button type="button" variant="outline" className="h-13 px-4" onClick={onVoltar} aria-label="Voltar">
          <ArrowLeft />
        </Button>
        <Button type="button" variant="brand" className="h-13 flex-1 text-base" disabled={!!falta} onClick={onAvancar}>
          Revisar
        </Button>
      </BarraAcao>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Revisar e enviar
// ---------------------------------------------------------------------------

function EtapaRevisar({ r, plano, onEditar, onEnviado }: { r: Rascunho; plano: PlanoZona; onEditar: (etapa: number) => void; onEnviado: (pc: PreCadastro) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const c = r.cliente;
  const cob = r.cobertura!;

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      const pc = await preCadastroApi.enviar({
        nome: c.nome,
        cpfCnpj: c.documento,
        nascimento: c.nascimento || null,
        celular: c.celular || null,
        email: c.email || null,
        plano: { id: plano.plano_id!, nome: plano.nome },
        vencimentoDia: r.vencimentoDia!,
        logradouro: c.logradouro,
        numero: c.numero || null,
        complemento: c.complemento || null,
        referencia: c.referencia || null,
        bairro: c.bairro,
        cidade: c.cidade,
        cep: c.cep || null,
        popId: cob.popId ?? null,
        portadorId: cob.portadorId ?? null,
        nasId: cob.nasId ?? null,
      }, r.provedorId);
      onEnviado(pc);
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setEnviando(false);
    }
  }

  const linhas: { rotulo: string; valor: string; etapa: number }[] = [
    { rotulo: "Plano", valor: `${plano.nome}${reais(plano.valor) ? ` · ${reais(plano.valor)}/mês` : ""}`, etapa: 1 },
    { rotulo: "Vencimento", valor: `Dia ${r.vencimentoDia}`, etapa: 1 },
    { rotulo: "Titular", valor: c.nome, etapa: 2 },
    { rotulo: "Documento", valor: c.documento, etapa: 2 },
    ...(c.nascimento ? [{ rotulo: "Nascimento", valor: c.nascimento, etapa: 2 }] : []),
    { rotulo: "Celular", valor: c.celular, etapa: 2 },
    ...(c.email ? [{ rotulo: "E-mail", valor: c.email, etapa: 2 }] : []),
    {
      rotulo: "Endereço",
      valor: [`${c.logradouro}, ${c.numero || "S/N"}`, c.complemento, c.bairro, c.cidade, c.cep].filter(Boolean).join(" · "),
      etapa: 2,
    },
    ...(c.referencia ? [{ rotulo: "Referência", valor: c.referencia, etapa: 2 }] : []),
  ];

  return (
    <>
      <Titulo n={4} sub="Confira com o cliente. Depois de enviado, a correção é pelo SGP.">
        Revisar e enviar
      </Titulo>

      <dl className="divide-y divide-border rounded-xl border border-border bg-card">
        {linhas.map((l) => (
          <div key={l.rotulo} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{l.rotulo}</dt>
              <dd className="break-words text-base">{l.valor}</dd>
            </div>
            <button type="button" onClick={() => onEditar(l.etapa)} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-primary">
              Editar
            </button>
          </div>
        ))}
      </dl>

      {erro && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      )}

      <BarraAcao>
        <Button type="button" variant="outline" className="h-13 px-4" onClick={() => onEditar(2)} aria-label="Voltar" disabled={enviando}>
          <ArrowLeft />
        </Button>
        <Button type="button" variant="brand" className="h-13 flex-1 text-base" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? <Loader2 className="animate-spin" /> : null}
          {enviando ? "Cadastrando no SGP…" : erro ? "Tentar de novo" : "Enviar pré-cadastro"}
        </Button>
      </BarraAcao>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Agendar
// ---------------------------------------------------------------------------

function EtapaAgendar({ pc, onNovo }: { pc: PreCadastro; onNovo: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState<BuscaOs | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [erroRede, setErroRede] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<number | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [feito, setFeito] = useState<{ dia: string; turno: TurnoAgenda } | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // Procura a OS de instalacao a cada 3 s, ate achar ou estourar as tentativas.
  useEffect(() => {
    if (busca?.encontrada || tentativa >= TENTATIVAS_OS) return;
    const t = setTimeout(
      async () => {
        try {
          const b = await preCadastroApi.os(pc.id);
          if (!vivo.current) return;
          setErroRede(null);
          setBusca(b);
          if (!b.encontrada) setTentativa((n) => n + 1);
        } catch (e) {
          if (!vivo.current) return;
          setErroRede(mensagem(e));
          setTentativa((n) => n + 1);
        }
      },
      tentativa === 0 ? 0 : 3000,
    );
    return () => clearTimeout(t);
  }, [pc.id, tentativa, busca?.encontrada]);

  async function marcar() {
    if (!busca?.encontrada || escolha == null) return;
    const v = busca.vagas[escolha]!;
    setMarcando(true);
    try {
      await preCadastroApi.agendar(pc.id, v.dia, v.turno);
      setFeito({ dia: v.dia, turno: v.turno });
      void queryClient.invalidateQueries({ queryKey: ["pre-cadastro", "lista"] });
      toast({ titulo: "Instalação agendada", descricao: `${rotuloDiaAgenda(v.dia)}, ${ROTULO_TURNO[v.turno]}`, variante: "sucesso" });
    } catch (e) {
      toast({ titulo: "Não deu para marcar", descricao: mensagem(e), variante: "erro" });
      // Vaga tomada no meio do caminho: recarrega a grade.
      setEscolha(null);
      setBusca(null);
      setTentativa(0);
    } finally {
      setMarcando(false);
    }
  }

  const desistiu = !busca?.encontrada && tentativa >= TENTATIVAS_OS;

  if (feito || pc.status === "agendado") {
    return <Comprovante pc={pc} visita={feito} onNovo={onNovo} />;
  }

  return (
    <>
      <Titulo n={5} sub={`${pc.clienteNome}${pc.protocolo ? ` · Protocolo ${pc.protocolo}` : ""}`}>
        Agendar a instalação
      </Titulo>

      {!busca?.encontrada && !desistiu && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <p className="flex items-center gap-2 font-semibold">
            <Loader2 className="size-5 animate-spin text-primary" /> Procurando a OS de instalação no SGP…
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="h-full bg-primary transition-[width] duration-700" style={{ width: `${Math.max(6, (tentativa / TENTATIVAS_OS) * 100)}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">{erroRede ?? "O SGP abre a OS junto com o contrato. Leva alguns segundos."}</p>
        </div>
      )}

      {desistiu && (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-warning/50 bg-warning/10 p-5">
          <p className="flex items-center gap-2 font-display text-lg font-bold">
            <TriangleAlert className="size-5 text-warning" /> A OS ainda não apareceu
          </p>
          <p className="text-sm">
            O cadastro foi feito. Quando a OS de instalação aparecer, o robô de agendamento manda as datas para o WhatsApp do cliente. Você também pode tentar
            de novo daqui a pouco, em "Enviados sem visita marcada".
          </p>
          <div className="flex">
            <BotaoConversa pc={pc} />
          </div>
          <BarraAcao>
            <Button type="button" variant="outline" className="h-13 flex-1" onClick={() => setTentativa(0)}>
              <RotateCcw /> Procurar de novo
            </Button>
            <Button type="button" variant="brand" className="h-13 flex-1" onClick={onNovo}>
              Novo cadastro
            </Button>
          </BarraAcao>
        </div>
      )}

      {busca?.encontrada && (
        <>
          {busca.vagas.length === 0 ? (
            <p className="rounded-xl border-2 border-warning/50 bg-warning/10 p-4 text-sm">
              A agenda está cheia nos próximos dias. O robô oferece as datas ao cliente assim que abrir vaga.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Dia e turno da instalação">
              {busca.vagas.map((v, i) => (
                <button
                  key={`${v.dia}|${v.turno}`}
                  type="button"
                  role="radio"
                  aria-checked={escolha === i}
                  aria-label={`${rotuloDiaAgenda(v.dia)}, ${ROTULO_TURNO[v.turno]}, ${v.livres} ${v.livres === 1 ? "vaga" : "vagas"}`}
                  onClick={() => setEscolha(i)}
                  className={cn(
                    "flex min-h-20 flex-col items-start justify-center gap-0.5 rounded-xl px-3.5 py-3 text-left transition-colors",
                    escolha === i ? "border-2 border-primary bg-primary/10" : "border border-border bg-card hover:bg-secondary",
                  )}
                >
                  <span className="font-display text-lg font-bold capitalize">{rotuloDiaAgenda(v.dia)}</span>
                  <span className="text-sm">{ROTULO_TURNO[v.turno]}</span>
                  <span className="text-xs text-muted-foreground">
                    {v.livres} {v.livres === 1 ? "vaga" : "vagas"}
                  </span>
                </button>
              ))}
            </div>
          )}
          <BarraAcao>
            <Button type="button" variant="outline" className="h-13 px-4" onClick={onNovo} aria-label="Agendar depois">
              Depois
            </Button>
            <Button type="button" variant="brand" className="h-13 flex-1 text-base" disabled={escolha == null || marcando} onClick={() => void marcar()}>
              {marcando ? <Loader2 className="animate-spin" /> : null}
              {marcando ? "Marcando…" : "Confirmar com o cliente"}
            </Button>
          </BarraAcao>
        </>
      )}
    </>
  );
}

/** Fala com o cliente pelo WhatsApp oficial do provedor e abre a conversa em "Clientes". */
function BotaoConversa({ pc }: { pc: PreCadastro }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [abrindo, setAbrindo] = useState(false);
  async function abrir() {
    setAbrindo(true);
    try {
      const { conversaId } = await preCadastroApi.conversa(pc.id);
      navigate(`/chat-clientes?conversa=${conversaId}`);
    } catch (e) {
      toast({ titulo: "Não deu para abrir a conversa", descricao: mensagem(e), variante: "erro" });
    } finally {
      setAbrindo(false);
    }
  }
  return (
    <Button type="button" variant="outline" className="h-13 flex-1" disabled={abrindo} onClick={() => void abrir()}>
      {abrindo ? <Loader2 className="animate-spin" /> : <MessageCircle />}
      {abrindo ? "Abrindo…" : "WhatsApp do cliente"}
    </Button>
  );
}

/** O fim: o que o vendedor mostra ao cliente antes de ir embora. */
function Comprovante({ pc, visita, onNovo }: { pc: PreCadastro; visita: { dia: string; turno: TurnoAgenda } | null; onNovo: () => void }) {
  const { toast } = useToast();
  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border-2 border-success/50 bg-card">
        <div className="flex items-center gap-3 bg-success/10 px-5 py-4">
          <CheckCircle2 className="size-7 text-success" />
          <p className="font-display text-xl font-bold">{visita ? "Instalação agendada" : "Visita já marcada"}</p>
        </div>
        <div className="flex flex-col gap-4 border-t-2 border-dashed border-border px-5 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</p>
            <p className="text-lg font-semibold">{pc.clienteNome}</p>
            {pc.plano && <p className="text-sm text-muted-foreground">{pc.plano}</p>}
          </div>
          {visita && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Visita</p>
              <p className="font-display text-2xl font-extrabold capitalize">
                {rotuloDiaAgenda(visita.dia)} · {ROTULO_TURNO[visita.turno]}
              </p>
              <p className="text-sm text-muted-foreground">Alguém precisa estar no local. Na véspera o cliente recebe um lembrete no WhatsApp.</p>
            </div>
          )}
          {pc.protocolo && (
            <button
              type="button"
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-secondary px-3.5 text-left"
              onClick={() => {
                void navigator.clipboard?.writeText(pc.protocolo!).then(
                  () => toast({ titulo: "Protocolo copiado", variante: "sucesso" }),
                  () => undefined,
                );
              }}
            >
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Protocolo</span>
                <span className="font-mono text-lg font-semibold tracking-wide">{pc.protocolo}</span>
              </span>
              <Copy className="size-5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
      <BarraAcao>
        <BotaoConversa pc={pc} />
        <Button type="button" variant="brand" className="h-13 flex-1 text-base" onClick={onNovo}>
          Novo cadastro
        </Button>
      </BarraAcao>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lateral (computador)
// ---------------------------------------------------------------------------

function Resumo({ r, plano, enviado }: { r: Rascunho; plano: PlanoZona | null; enviado: PreCadastro | null }) {
  const leitura = r.cobertura ? lerCobertura(r.cobertura) : null;
  const itens = enviado
    ? [
        ["Cliente", enviado.clienteNome],
        ["Plano", enviado.plano ?? "—"],
        ["Protocolo", enviado.protocolo ?? "—"],
      ]
    : [
        ["Cobertura", leitura ? leitura.titulo : "—"],
        ["Plano", plano?.nome ?? "—"],
        ["Vencimento", r.vencimentoDia ? `Dia ${r.vencimentoDia}` : "—"],
        ["Cliente", r.cliente.nome || "—"],
      ];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resumo</p>
      <dl className="flex flex-col gap-2 text-sm">
        {itens.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
