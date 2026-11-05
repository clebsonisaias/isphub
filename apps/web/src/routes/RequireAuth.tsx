import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { UserRole, podeRotaWeb } from "@isphub/shared";
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

  const inicio = inicioDoPapel(usuario.role, usuario.permissoes);
  // Supervisor com áreas definidas, entrando por endereço direto numa tela fora
  // delas: vai para o início dele. Se a tela barrada é o próprio início (não
  // deveria: o início é calculado com as mesmas regras), mostra o aviso em vez
  // de redirecionar em círculo. A API barra de qualquer jeito; isto evita a
  // tela cheia de 403.
  const foraDasAreas = usuario.role === UserRole.GESTOR && !podeRotaWeb(usuario.permissoes ?? null, location.pathname);
  if (foraDasAreas && location.pathname !== inicio) {
    return <Navigate to={inicio} replace />;
  }

  if (foraDasAreas || (roles && !roles.includes(usuario.role))) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
        <p>Você não tem permissão para acessar esta página.</p>
        <Link to={inicio} replace className="font-medium text-primary hover:underline">
          Ir para o início
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
