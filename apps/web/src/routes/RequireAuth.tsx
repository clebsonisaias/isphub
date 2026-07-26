import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { BrandLoader } from "@/components/BrandLoader";

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
      <div className="flex min-h-svh items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Voce nao tem permissao para acessar esta pagina.
      </div>
    );
  }

  return <>{children}</>;
}
