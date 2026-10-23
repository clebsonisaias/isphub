import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { BrandLoader } from "@/components/BrandLoader";
import { inicioDoPapel } from "@/lib/inicioPorPapel";

/** Protege uma rota: exige sessao valida e, opcionalmente, um dos papeis informados. */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  const { usuario, carregando } = useAuth();
  const location = useLocation();

  if (carregando) {
    return <BrandLoader />;
  }

  if (!usuario) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(usuario.role)) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
        <p>Você não tem permissão para acessar esta página.</p>
        <Link to={inicioDoPapel(usuario.role)} replace className="font-medium text-primary hover:underline">
          Ir para o início
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
