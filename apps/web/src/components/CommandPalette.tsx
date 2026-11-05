import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { UserRole, podeRotaWeb, type FilaItem, type Provedor } from "@isphub/shared";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth, usePodeChamar } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { filaApi } from "@/lib/filaApi";
import { provedoresApi } from "@/lib/adminApi";
import { cn } from "@/lib/utils";
import {
  Search,
  LayoutGrid,
  Map as MapIcon,
  PackageX,
  BarChart3,
  Router as RouterIcon,
  Settings,
  UserCircle,
  SunMoon,
  Building2,
  Loader2,
} from "lucide-react";

type Comando =
  | { tipo: "navegar"; id: string; label: string; icon: typeof LayoutGrid; to: string }
  | { tipo: "tema"; id: string; label: string }
  | { tipo: "provedor"; id: string; label: string; provedorId: string }
  | { tipo: "os"; id: string; label: string; sublabel: string; item: FilaItem };

/**
 * Paleta de comandos global (Cmd/Ctrl+K) — maior salto de "intuitivo" do
 * redesign: navega entre telas, busca OS por cliente/protocolo/contrato/
 * endereço (mesmo endpoint da busca do Painel), pula pra config de um
 * provedor (admin) e alterna tema — tudo sem soltar o teclado. Montada uma vez
 * por pagina dentro do AppShell (cada pagina instancia o proprio AppShell),
 * entao o atalho global acompanha o ciclo de vida da pagina atual.
 */
export function CommandPalette() {
  const [aberto, setAberto] = useState(false);
  const [query, setQuery] = useState("");
  const [resultadosOs, setResultadosOs] = useState<FilaItem[]>([]);
  const [buscandoOs, setBuscandoOs] = useState(false);
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const { toggleTheme } = useTheme();
  // Supervisor sem nenhuma area que leia a fila: buscar OS so renderia 403.
  const podeChamar = usePodeChamar();
  const buscaOs = podeChamar("GET", "/fila");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAberto((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setQuery("");
    setAtivo(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    if (usuario?.role === UserRole.ADMIN) {
      provedoresApi.listar().then(setProvedores).catch(() => {});
    }
    return () => cancelAnimationFrame(raf);
  }, [aberto, usuario]);

  useEffect(() => {
    if (!aberto || !buscaOs || query.trim().length < 2) {
      setResultadosOs([]);
      return;
    }
    let cancelado = false;
    setBuscandoOs(true);
    const t = setTimeout(() => {
      filaApi
        .listar({ busca: query.trim(), grupo: "abertos" })
        .then((r) => {
          if (!cancelado) setResultadosOs(r.itens.slice(0, 6));
        })
        .catch(() => {
          if (!cancelado) setResultadosOs([]);
        })
        .finally(() => {
          if (!cancelado) setBuscandoOs(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [query, aberto, buscaOs]);

  const navegarComandos = useMemo<Comando[]>(() => {
    const base: Comando[] = [
      { tipo: "navegar", id: "painel", label: "Painel", icon: LayoutGrid, to: "/" },
      { tipo: "navegar", id: "mapa", label: "Mapa", icon: MapIcon, to: "/mapa" },
    ];
    if (usuario?.role !== UserRole.TECNICO) {
      base.push({ tipo: "navegar", id: "retiradas", label: "Retiradas", icon: PackageX, to: "/retiradas" });
      base.push({ tipo: "navegar", id: "dashboard", label: "Dashboard", icon: BarChart3, to: "/dashboard" });
      base.push({ tipo: "navegar", id: "provisionar", label: "Provisionar ONU", icon: RouterIcon, to: "/provisionamento" });
    }
    base.push({ tipo: "navegar", id: "perfil", label: "Meu perfil", icon: UserCircle, to: "/perfil" });
    if (usuario?.role === UserRole.ADMIN) {
      base.push({ tipo: "navegar", id: "admin", label: "Administração", icon: Settings, to: "/admin" });
    }
    if (usuario?.role === UserRole.GESTOR) return base.filter((c) => c.tipo !== "navegar" || podeRotaWeb(usuario.permissoes ?? null, c.to));
    return base;
  }, [usuario]);

  const termo = query.trim().toLowerCase();
  const navegarFiltrados = termo ? navegarComandos.filter((c) => c.label.toLowerCase().includes(termo)) : navegarComandos;
  const osComandos: Comando[] = resultadosOs.map((i) => ({
    tipo: "os",
    id: `os-${i.id}`,
    label: i.clienteNome ?? `OS #${i.sgpOsId}`,
    sublabel: [i.protocolo ? `Protocolo ${i.protocolo}` : null, i.provedor?.nome].filter(Boolean).join(" · "),
    item: i,
  }));
  const provedorComandos: Comando[] =
    termo && usuario?.role === UserRole.ADMIN
      ? provedores
          .filter((p) => p.nome.toLowerCase().includes(termo))
          .map((p) => ({ tipo: "provedor" as const, id: `prov-${p.id}`, label: p.nome, provedorId: p.id }))
      : [];
  const temaLabel = "Alternar tema (claro/escuro)";
  const temaComandos: Comando[] = !termo || temaLabel.toLowerCase().includes(termo) ? [{ tipo: "tema", id: "tema", label: temaLabel }] : [];

  const todos: Comando[] = [...navegarFiltrados, ...osComandos, ...provedorComandos, ...temaComandos];

  function executar(cmd: Comando) {
    setAberto(false);
    if (cmd.tipo === "navegar") navigate(cmd.to);
    else if (cmd.tipo === "tema") toggleTheme();
    else if (cmd.tipo === "provedor") navigate(`/admin/provedores/${cmd.provedorId}`);
    else if (cmd.tipo === "os") navigate(`/?q=${encodeURIComponent(cmd.item.clienteNome ?? cmd.item.protocolo ?? "")}`);
  }

  function onKeyDownInput(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((i) => Math.min(i + 1, Math.max(todos.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (todos[ativo]) executar(todos[ativo]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Buscar (Ctrl+K)"
        aria-label="Abrir busca rápida"
        className="flex h-9 items-center gap-2 rounded-xl border border-border/50 bg-secondary/30 px-2.5 text-xs text-muted-foreground outline-none transition-all hover:border-border hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="hidden xl:inline font-medium">Buscar...</span>
        <kbd className="hidden items-center gap-0.5 rounded-md border border-border/40 bg-background/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground shadow-2xs sm:inline-flex">
          <span className="text-[11px]">⌘</span>K
        </kbd>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogPrimitive.Title className="sr-only">Busca rápida</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDownInput}
              placeholder="Ir para uma tela, buscar OS, provedor..."
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {buscandoOs && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {navegarFiltrados.length > 0 && (
              <CommandGroup label="Navegar">
                {navegarFiltrados.map((c) => (
                  <CommandItem key={c.id} ativo={todos.indexOf(c) === ativo} onClick={() => executar(c)}>
                    {c.tipo === "navegar" && <c.icon className="size-4 shrink-0 text-muted-foreground" />}
                    {c.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {osComandos.length > 0 && (
              <CommandGroup label="Ordens de serviço">
                {osComandos.map((c) => (
                  <CommandItem key={c.id} ativo={todos.indexOf(c) === ativo} onClick={() => executar(c)}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{c.label}</span>
                      {c.tipo === "os" && c.sublabel && <span className="truncate text-xs text-muted-foreground">{c.sublabel}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {provedorComandos.length > 0 && (
              <CommandGroup label="Provedores">
                {provedorComandos.map((c) => (
                  <CommandItem key={c.id} ativo={todos.indexOf(c) === ativo} onClick={() => executar(c)}>
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    {c.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {temaComandos.length > 0 && (
              <CommandGroup label="Preferências">
                {temaComandos.map((c) => (
                  <CommandItem key={c.id} ativo={todos.indexOf(c) === ativo} onClick={() => executar(c)}>
                    <SunMoon className="size-4 shrink-0 text-muted-foreground" />
                    {c.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {todos.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nada encontrado.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CommandGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function CommandItem({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        ativo ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}
