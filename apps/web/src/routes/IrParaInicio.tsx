import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { inicioDoPapel } from "@/lib/inicioPorPapel";

/**
 * Quem ABRE o app pela raiz cai na tela do seu papel (gestor no Despacho,
 * atendente em Marcar visita). Uma vez por carregamento da página: depois,
 * clicar em Painel abre o Painel. O login já leva para a tela do papel e marca
 * a decisão como tomada (ver `inicioJaDecidido`).
 */
const ENTROU_PELA_RAIZ = typeof window !== "undefined" && window.location.pathname === "/" && window.location.search === "";
let decidido = false;

/** O login já mandou para a tela do papel: a raiz não redireciona de novo nesta sessão. */
export function inicioJaDecidido() {
  decidido = true;
}

export function IrParaInicio({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  // useState + efeito (e não uma variável mudada no render): o StrictMode renderiza duas vezes.
  const [destino] = useState(() => (ENTROU_PELA_RAIZ && !decidido ? inicioDoPapel(usuario?.role) : "/"));
  useEffect(() => {
    decidido = true;
  }, []);
  return destino !== "/" ? <Navigate to={destino} replace /> : <>{children}</>;
}
