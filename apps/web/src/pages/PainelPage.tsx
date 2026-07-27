import { UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { FilaWorkspace } from "@/components/fila/FilaWorkspace";

/** Painel da equipe ISPhub: só OS internas (equipe="interna") — retiradas têm
 *  tela própria em /retiradas, nunca se misturam aqui. */
export function PainelPage() {
  const { usuario } = useAuth();
  const ehProvedor = usuario?.role === UserRole.PROVEDOR;
  const ehTecnico = usuario?.role === UserRole.TECNICO;

  const subtitulo = ehTecnico
    ? "Suas ordens de serviço"
    : `Ordens de serviço de ${ehProvedor ? "seu provedor" : "todos os provedores"}`;

  return <FilaWorkspace equipe="interna" titulo="Painel de Ordens de Serviço" subtitulo={subtitulo} />;
}
