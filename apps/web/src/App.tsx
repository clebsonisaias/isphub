import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { UserRole } from "@isphub/shared";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { RealtimeProvider } from "@/lib/realtime";
import { RequireAuth } from "@/routes/RequireAuth";
import { IrParaInicio } from "@/routes/IrParaInicio";
import { LoginPage } from "@/pages/LoginPage";
import { BrandLoader } from "@/components/BrandLoader";

// Cada pagina e um chunk proprio: quem abre o Painel nao baixa leaflet, o
// financeiro nem o BI da frota. Login fica estatico — e a primeira pintura.
const RecuperarSenhaPage = lazy(() => import("@/pages/RecuperarSenhaPage").then((m) => ({ default: m.RecuperarSenhaPage })));
const SmtpPage = lazy(() => import("@/pages/admin/SmtpPage").then((m) => ({ default: m.SmtpPage })));
const RedefinirSenhaPage = lazy(() => import("@/pages/RedefinirSenhaPage").then((m) => ({ default: m.RedefinirSenhaPage })));
const PainelPage = lazy(() => import("@/pages/PainelPage").then((m) => ({ default: m.PainelPage })));
const OsPage = lazy(() => import("@/pages/OsPage").then((m) => ({ default: m.OsPage })));
const RetiradasPage = lazy(() => import("@/pages/RetiradasPage").then((m) => ({ default: m.RetiradasPage })));
const MapaPage = lazy(() => import("@/pages/MapaPage").then((m) => ({ default: m.MapaPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ProvisionamentoPage = lazy(() => import("@/pages/ProvisionamentoPage").then((m) => ({ default: m.ProvisionamentoPage })));
const FinanceiroPage = lazy(() => import("@/pages/FinanceiroPage").then((m) => ({ default: m.FinanceiroPage })));
const FinanceiroRelatoriosPage = lazy(() => import("@/pages/FinanceiroRelatoriosPage").then((m) => ({ default: m.FinanceiroRelatoriosPage })));
const FinanceiroRecorrenciasPage = lazy(() => import("@/pages/FinanceiroRecorrenciasPage").then((m) => ({ default: m.FinanceiroRecorrenciasPage })));
const FinanceiroParceladosPage = lazy(() => import("@/pages/FinanceiroParceladosPage").then((m) => ({ default: m.FinanceiroParceladosPage })));
const FinanceiroProvisoesPage = lazy(() => import("@/pages/FinanceiroProvisoesPage").then((m) => ({ default: m.FinanceiroProvisoesPage })));
const FinanceiroFrotaPage = lazy(() => import("@/pages/FinanceiroFrotaPage").then((m) => ({ default: m.FinanceiroFrotaPage })));
const FrotaVeiculosPage = lazy(() => import("@/pages/FrotaVeiculosPage").then((m) => ({ default: m.FrotaVeiculosPage })));
const EscalaPage = lazy(() => import("@/pages/EscalaPage").then((m) => ({ default: m.EscalaPage })));
const AgendaPage = lazy(() => import("@/pages/AgendaPage").then((m) => ({ default: m.AgendaPage })));
const DespachoPage = lazy(() => import("@/pages/DespachoPage").then((m) => ({ default: m.DespachoPage })));
const MarcarVisitaPage = lazy(() => import("@/pages/MarcarVisitaPage").then((m) => ({ default: m.MarcarVisitaPage })));
const FrotaBiPage = lazy(() => import("@/pages/FrotaBiPage").then((m) => ({ default: m.FrotaBiPage })));
const ProdutividadePage = lazy(() => import("@/pages/ProdutividadePage").then((m) => ({ default: m.ProdutividadePage })));
const FrotaMapaPage = lazy(() => import("@/pages/FrotaMapaPage").then((m) => ({ default: m.FrotaMapaPage })));
const VeiculoPage = lazy(() => import("@/pages/VeiculoPage").then((m) => ({ default: m.VeiculoPage })));
const ChatPage = lazy(() => import("@/pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const ClientesChatPage = lazy(() => import("@/pages/ClientesChatPage").then((m) => ({ default: m.ClientesChatPage })));
const ProvedoresPage = lazy(() => import("@/pages/admin/ProvedoresPage").then((m) => ({ default: m.ProvedoresPage })));
const ProvedorDetailPage = lazy(() => import("@/pages/admin/ProvedorDetailPage").then((m) => ({ default: m.ProvedorDetailPage })));
const CategoriasPage = lazy(() => import("@/pages/admin/CategoriasPage").then((m) => ({ default: m.CategoriasPage })));
const UsuariosPage = lazy(() => import("@/pages/admin/UsuariosPage").then((m) => ({ default: m.UsuariosPage })));
const ModulosPage = lazy(() => import("@/pages/admin/ModulosPage").then((m) => ({ default: m.ModulosPage })));
const CanaisWhatsappPage = lazy(() => import("@/pages/admin/CanaisWhatsappPage").then((m) => ({ default: m.CanaisWhatsappPage })));
const PerfilPage = lazy(() => import("@/pages/PerfilPage").then((m) => ({ default: m.PerfilPage })));

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <RealtimeProvider>
              <Suspense fallback={<BrandLoader />}>
                <Routes>
                  {/* Publicas: quem chega nelas nao tem (ou perdeu) a sessao. */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/recuperar-senha" element={<RecuperarSenhaPage />} />
                  <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />
                  <Route
                    path="/"
                    element={
                      <RequireAuth>
                        {/* Quem abre o app pela raiz cai na tela do papel; o Painel segue em "/". */}
                        <IrParaInicio>
                          <PainelPage />
                        </IrParaInicio>
                      </RequireAuth>
                    }
                  />
                  {/* Uma OS com link proprio; o dialogo da fila e o atalho. Quem pode
                      ver cada OS e decidido na API (escopo por provedor/tecnico). */}
                  <Route
                    path="/os/:id"
                    element={
                      <RequireAuth>
                        <OsPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/mapa"
                    element={
                      <RequireAuth>
                        <MapaPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/retiradas"
                    element={
                      <RequireAuth
                        roles={[
                          UserRole.ADMIN,
                          UserRole.GESTOR,
                          UserRole.PROVEDOR,
                        ]}
                      >
                        <RetiradasPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/dashboard"
                    element={
                      <RequireAuth
                        roles={[
                          UserRole.ADMIN,
                          UserRole.GESTOR,
                          UserRole.PROVEDOR,
                        ]}
                      >
                        <DashboardPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/provisionamento"
                    element={
                      <RequireAuth
                        roles={[
                          UserRole.ADMIN,
                          UserRole.GESTOR,
                          UserRole.PROVEDOR,
                        ]}
                      >
                        <ProvisionamentoPage />
                      </RequireAuth>
                    }
                  />
                  {/*
                    Financeiro da HubISP: ADMIN e so. Nem GESTOR nem PROVEDOR —
                    a tabela tem o preco combinado com cada provedor, e um
                    provedor logado veria o dos concorrentes. Terceira camada da
                    guarda (as outras duas: rolesPadrao do modulo e requireRole
                    na rota da API).
                  */}
                  <Route
                    path="/financeiro"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <FinanceiroPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/financeiro/recorrencias"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <FinanceiroRecorrenciasPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/financeiro/parcelados"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <FinanceiroParceladosPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/financeiro/provisoes"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <FinanceiroProvisoesPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/financeiro/frota"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <FinanceiroFrotaPage />
                      </RequireAuth>
                    }
                  />
                  {/*
                    Frota (operacional) — ADMIN e GESTOR. Nao fica sob /financeiro:
                    aquela arvore inteira e ADMIN-only por desenho, e quem despacha
                    precisa saber quais viaturas existem.
                  */}
                  {/*
                    Produtividade — ADMIN e GESTOR. TECNICO fica de fora: um
                    ranking em que cada um ve a propria posicao contra a dos
                    colegas muda o que as pessoas fazem, e essa e uma decisao de
                    gestao, nao de codigo.
                  */}
                  <Route
                    path="/produtividade"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <ProdutividadePage />
                      </RequireAuth>
                    }
                  />
                  {/*
                    Agenda de visitas. Substitui a planilha de agendamento de OS
                    do Drive. Vizinha da Escala e nao a mesma tela: a Escala
                    distribui PESSOAS entre viaturas, a Agenda distribui VISITAS
                    entre dias — e quem responde por cada uma abre a tela em
                    momentos diferentes do dia.
                  */}
                  {/* Despacho: fila sem visita + Quadro do dia (técnico x turno) + mapa com as viaturas. */}
                  <Route
                    path="/despacho"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <DespachoPage />
                      </RequireAuth>
                    }
                  />
                  {/* Marcar visita: a tela da atendente ao telefone (busca, vagas, marcar). */}
                  <Route
                    path="/marcar-visita"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR, UserRole.ATENDENTE]}>
                        <MarcarVisitaPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/agenda"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR, UserRole.ATENDENTE]}>
                        <AgendaPage />
                      </RequireAuth>
                    }
                  />
                  {/*
                    Escala do dia. Fica FORA de /frota porque a pergunta e outra:
                    /frota e "quais viaturas existem", esta e "quem vai em qual
                    hoje". Enterrada num link interno da frota, ninguem acharia
                    antes das 7h, que e quando ela serve.
                  */}
                  <Route
                    path="/escala"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <EscalaPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/frota"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <FrotaVeiculosPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/frota/mapa"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <FrotaMapaPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/frota/bi"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <FrotaBiPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/frota/veiculos/:id"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
                        <VeiculoPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/financeiro/relatorios"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <FinanceiroRelatoriosPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/chat"
                    element={
                      <RequireAuth
                        roles={[
                          UserRole.ADMIN,
                          UserRole.GESTOR,
                          UserRole.TECNICO,
                        ]}
                      >
                        <ChatPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/chat-clientes"
                    element={
                      <RequireAuth
                        roles={[
                          UserRole.ADMIN,
                          UserRole.GESTOR,
                          UserRole.TECNICO,
                        ]}
                      >
                        <ClientesChatPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/perfil"
                    element={
                      <RequireAuth>
                        <PerfilPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <ProvedoresPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin/provedores/:id"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <ProvedorDetailPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin/categorias"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <CategoriasPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin/usuarios"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <UsuariosPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin/modulos"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <ModulosPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin/canais-whatsapp"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <CanaisWhatsappPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin/smtp"
                    element={
                      <RequireAuth roles={[UserRole.ADMIN]}>
                        <SmtpPage />
                      </RequireAuth>
                    }
                  />
                </Routes>
              </Suspense>
            </RealtimeProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
