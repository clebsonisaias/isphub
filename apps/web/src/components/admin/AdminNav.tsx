import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Building2, Tags } from "lucide-react";

const ITEMS = [
  { to: "/admin", label: "Provedores", icon: Building2, match: (p: string) => p === "/admin" || p.startsWith("/admin/provedores") },
  { to: "/admin/categorias", label: "Categorias", icon: Tags, match: (p: string) => p.startsWith("/admin/categorias") },
];

/** Sub-navegação da área Administração (Provedores x Categorias). */
export function AdminNav() {
  const location = useLocation();
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {ITEMS.map(({ to, label, icon: Icon, match }) => (
        <Link
          key={to}
          to={to}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            match(location.pathname)
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </div>
  );
}
