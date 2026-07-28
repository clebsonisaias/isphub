import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { USER_ROLE_LABEL, UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationBell } from "@/components/NotificationBell";
import { CommandPalette } from "@/components/CommandPalette";
import { HeaderClock } from "@/components/HeaderClock";
import { cn } from "@/lib/utils";
import { APP_BUILD_ID, APP_VERSION_LABEL } from "@/lib/version";
import { LogOut, Map, LayoutGrid, BarChart3, Settings, PackageX, Router, UserCircle, Sun, Moon } from "lucide-react";

/** Dashboard e Retiradas sao so pra quem enxerga mais de uma OS/provedor — tecnico ve so as proprias. */
const NAV_ITEMS = [
  { to: "/", label: "Painel", icon: LayoutGrid, ocultoPara: [] as UserRole[] },
  { to: "/mapa", label: "Mapa", icon: Map, ocultoPara: [] as UserRole[] },
  // Retirada e feita por equipe de fora — tecnico da ISPhub nunca executa
  // uma, a tela seria sempre vazia pra ele.
  { to: "/retiradas", label: "Retiradas", icon: PackageX, ocultoPara: [UserRole.TECNICO] },
  { to: "/dashboard", label: "Dashboard", icon: BarChart3, ocultoPara: [UserRole.TECNICO] },
  // Provisionar ONU (FTTX): técnico faz pelo app; na web é ferramenta de admin/gestor/provedor.
  { to: "/provisionamento", label: "Provisionar", icon: Router, ocultoPara: [UserRole.TECNICO] },
];

/**
 * Classe de um item de navegacao — um unico elemento serve dois papeis pelo
 * breakpoint `lg`: aba de rodape (mobile/tablet, alcance de polegar) e pilula
 * no cabecalho (desktop). Nunca existem os dois ao mesmo tempo (nao ha
 * duplicacao de Link/nome acessivel — so uma troca de layout via CSS), entao
 * o rotulo "Administração" continua unico na arvore de acessibilidade em
 * qualquer largura, do jeito que os testes e2e esperam.
 */
function navItemClass(ativo: boolean): string {
  return cn(
    "group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[0.65rem] font-medium transition-colors lg:flex-none lg:flex-row lg:gap-1.5 lg:rounded-full lg:px-3 lg:py-1.5 lg:text-sm",
    ativo ? "text-primary" : "text-muted-foreground hover:text-foreground lg:hover:bg-secondary/60",
  );
}

/**
 * Pilula de fundo do item de rota ativo no desktop — um unico elemento com
 * `layoutId` compartilhado entre os Links (motor de layout do Framer Motion
 * ve a posicao/tamanho mudar entre renders com IDs iguais e anima a
 * transicao), entao ela DESLIZA pra pilula seguinte em vez de piscar. So no
 * desktop (`hidden lg:block`) — no mobile o destaque já vem do icone-chip do
 * NavIcon, que não precisa de deslizamento (abas fixas, sem espaço de sobra).
 */
function NavActivePill({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  return (
    <motion.span
      aria-hidden
      layoutId="nav-active-pill"
      className="absolute inset-0 hidden rounded-full bg-primary/12 lg:block"
      transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
    />
  );
}

function NavIcon({ Icon, ativo }: { Icon: typeof LayoutGrid; ativo: boolean }) {
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-lg transition-colors lg:size-auto lg:rounded-none lg:bg-transparent",
        ativo && "bg-primary/12 lg:bg-transparent",
      )}
    >
      <Icon className="size-[1.15rem] shrink-0 lg:size-4" />
    </span>
  );
}

/** Iniciais do nome (ate 2 letras) pro avatar compacto do cabecalho. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const letras = partes.length > 1 ? [partes[0][0], partes[partes.length - 1][0]] : [partes[0]?.[0] ?? "?"];
  return letras.join("").toUpperCase();
}

/**
 * Menu do usuario (avatar) em popover — Perfil/Tema/Sair. Antes "Meu perfil"
 * ficava `hidden lg:flex` (sumia inteiro no mobile) e tema/sair eram botoes
 * soltos no cabecalho; agora e uma UNICA affordance, visivel em qualquer
 * largura — mais descobrivel no mobile e menos poluicao de icones no header.
 */
function UserMenu({ nome, role, onLogout }: { nome: string; role: UserRole; onLogout: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${nome} — ${USER_ROLE_LABEL[role]}`}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-secondary/60 lg:pr-2.5"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary font-display text-xs font-semibold text-foreground">
            {iniciais(nome)}
          </span>
          <span className="hidden text-left leading-tight xl:block">
            <span className="block text-sm font-medium text-foreground">{nome}</span>
            <span className="block text-xs text-muted-foreground">{USER_ROLE_LABEL[role]}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5">
        <div className="border-b border-border px-2.5 pb-2 pt-1 lg:hidden">
          <p className="truncate text-sm font-medium text-foreground">{nome}</p>
          <p className="text-xs text-muted-foreground">{USER_ROLE_LABEL[role]}</p>
        </div>
        <Link
          to="/perfil"
          onClick={() => setAberto(false)}
          className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
        >
          <UserCircle className="size-4 text-muted-foreground" />
          Meu perfil
        </Link>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
        >
          {theme === "dark" ? (
            <Sun className="size-4 text-muted-foreground" />
          ) : (
            <Moon className="size-4 text-muted-foreground" />
          )}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            onLogout();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** Casca comum das telas autenticadas: cabecalho com marca, navegação, usuario e logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="min-h-svh">
      {/*
        Sem backdrop-blur AQUI de proposito: `backdrop-filter` num ancestral
        cria containing block pra descendentes `position: fixed` (CSS
        Transforms spec) — a nav abaixo é fixa no rodape no mobile, e um
        header com blur faria ela "grudar" no fim do header (perto do topo)
        em vez do fim da viewport de verdade. O blur fica só na propria nav.
      */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95">
        {/* Fio de marca — um unico detalhe de cor no cabecalho, discreto. */}
        <div aria-hidden className="h-[2px] w-full brand-gradient-bg opacity-70" />
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:gap-2">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <span className="font-display text-lg font-bold tracking-tight">
              <span className="brand-gradient-text">ISP</span>
              <span className="text-foreground">hub</span>
            </span>
            <span
              className="hidden rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.6rem] font-medium tabular-nums text-muted-foreground xl:inline"
              title={APP_BUILD_ID ? `Build ${APP_BUILD_ID}` : undefined}
            >
              {APP_VERSION_LABEL}
            </span>
          </Link>

          {/*
            Navegacao unica: aba fixa no rodape abaixo de `lg` (alcance de
            polegar pro tecnico em campo no celular), pilulas no proprio
            cabecalho a partir de `lg`. `position: fixed` tira o elemento do
            fluxo do header no mobile sem precisar de outro componente —
            `lg:static` devolve ao fluxo normal da linha no desktop.
          */}
          {usuario && (
            <nav
              className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:static lg:inset-auto lg:z-auto lg:flex-1 lg:items-center lg:justify-start lg:gap-1 lg:border-t-0 lg:bg-transparent lg:pb-0 lg:backdrop-blur-none"
              aria-label="Navegação principal"
            >
              {NAV_ITEMS.filter((item) => !item.ocultoPara.includes(usuario.role)).map(({ to, label, icon: Icon }) => {
                const ativo = location.pathname === to;
                return (
                  <Link key={to} to={to} title={label} className={navItemClass(ativo)}>
                    {ativo && <NavActivePill shouldReduceMotion={!!shouldReduceMotion} />}
                    <NavIcon Icon={Icon} ativo={ativo} />
                    <span className="relative">{label}</span>
                  </Link>
                );
              })}
              {usuario.role === UserRole.ADMIN && (
                <Link
                  to="/admin"
                  title="Administração"
                  className={navItemClass(location.pathname.startsWith("/admin"))}
                >
                  {location.pathname.startsWith("/admin") && <NavActivePill shouldReduceMotion={!!shouldReduceMotion} />}
                  <NavIcon Icon={Settings} ativo={location.pathname.startsWith("/admin")} />
                  <span className="relative">Administração</span>
                </Link>
              )}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {usuario && <HeaderClock />}
            {usuario && <CommandPalette />}
            {usuario && <NotificationBell />}
            {usuario && <UserMenu nome={usuario.nome} role={usuario.role} onLogout={logout} />}
          </div>
        </div>
      </header>

      {/* pb extra no mobile: a aba de navegacao fixa no rodape nao pode
          cobrir o final da lista/conteudo. */}
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:pb-6">{children}</main>

      <footer className="mx-auto hidden max-w-7xl items-center justify-between px-4 py-4 text-xs text-muted-foreground lg:flex">
        <span>
          <span className="brand-gradient-text font-semibold">ISPhub</span> — central de campo multi-provedor
        </span>
        <span className="font-mono tabular-nums" title={APP_BUILD_ID ? `Build ${APP_BUILD_ID}` : undefined}>
          {APP_VERSION_LABEL}
        </span>
      </footer>
    </div>
  );
}
