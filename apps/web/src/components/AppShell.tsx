import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { USER_ROLE_LABEL, UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { APP_BUILD_DATE, APP_VERSION_LABEL } from "@/lib/version";
import { LogOut, Map, LayoutGrid, BarChart3, Settings } from "lucide-react";

/** Dashboard e so pra quem enxerga mais de uma OS/provedor — tecnico ve so as proprias. */
const NAV_ITEMS = [
  { to: "/", label: "Painel", icon: LayoutGrid, ocultoPara: [] as UserRole[] },
  { to: "/mapa", label: "Mapa", icon: Map, ocultoPara: [] as UserRole[] },
  { to: "/dashboard", label: "Dashboard", icon: BarChart3, ocultoPara: [UserRole.TECNICO] },
];

/** Casca comum das telas autenticadas: cabecalho com marca, navegação, usuario e logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight">
            <span>
              <span className="brand-gradient-text">ISP</span>
              <span className="text-foreground">hub</span>
            </span>
            <span className="hidden rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 text-[0.65rem] font-medium tabular-nums text-muted-foreground sm:inline">
              v{APP_VERSION_LABEL.replace(/^v/, "").split(" · ")[0]}
            </span>
          </Link>

          {usuario && (
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.filter((item) => !item.ocultoPara.includes(usuario.role)).map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    location.pathname === to
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              ))}
              {usuario.role === UserRole.ADMIN && (
                <Link
                  to="/admin"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    location.pathname.startsWith("/admin")
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Settings className="size-4" />
                  <span className="hidden sm:inline">Administração</span>
                </Link>
              )}
            </nav>
          )}

          <div className="flex shrink-0 items-center gap-3">
            {usuario && (
              <Link
                to="/perfil"
                className="hidden text-right leading-tight transition-colors hover:text-primary sm:block"
                title="Meu perfil"
              >
                <p className="text-sm font-medium text-foreground">{usuario.nome}</p>
                <p className="text-xs text-muted-foreground">{USER_ROLE_LABEL[usuario.role]}</p>
              </Link>
            )}
            <ThemeToggle />
            {usuario && (
              <Button variant="ghost" size="icon" onClick={logout} title="Sair" aria-label="Sair">
                <LogOut />
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

      <footer className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 text-xs text-muted-foreground">
        <span>
          <span className="brand-gradient-text font-semibold">ISPhub</span> — central de campo multi-provedor
        </span>
        <span className="tabular-nums" title={APP_BUILD_DATE ? `Build ${APP_BUILD_DATE}` : undefined}>
          {APP_VERSION_LABEL}
        </span>
      </footer>
    </div>
  );
}
