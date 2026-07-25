import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { USER_ROLE_LABEL, UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { LogOut, Map, LayoutGrid, BarChart3, Settings } from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Painel", icon: LayoutGrid },
  { to: "/mapa", label: "Mapa", icon: Map },
  { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
];

/** Casca comum das telas autenticadas: cabecalho com marca, navegação, usuario e logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
          <Link to="/" className="shrink-0 text-lg font-bold tracking-tight">
            <span className="brand-gradient-text">ISP</span>
            <span className="text-foreground">hub</span>
          </Link>

          {usuario && usuario.role !== UserRole.TECNICO && (
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-sm font-medium text-foreground">{usuario.nome}</p>
                <p className="text-xs text-muted-foreground">{USER_ROLE_LABEL[usuario.role]}</p>
              </div>
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
    </div>
  );
}
