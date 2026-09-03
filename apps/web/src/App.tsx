import { BrowserRouter, Routes, Route } from "react-router-dom";
import { UserRole } from "@isphub/shared";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { RealtimeProvider } from "@/lib/realtime";
import { RequireAuth } from "@/routes/RequireAuth";
import { LoginPage } from "@/pages/LoginPage";
import { RecuperarSenhaPage } from "@/pages/RecuperarSenhaPage";
import { SmtpPage } from "@/pages/admin/SmtpPage";
import { RedefinirSenhaPage } from "@/pages/RedefinirSenhaPage";
import { PainelPage } from "@/pages/PainelPage";
import { RetiradasPage } from "@/pages/RetiradasPage";
import { MapaPage } from "@/pages/MapaPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProvisionamentoPage } from "@/pages/ProvisionamentoPage";
import { FinanceiroPage } from "@/pages/FinanceiroPage";
import { FinanceiroRelatoriosPage } from "@/pages/FinanceiroRelatoriosPage";
import { FinanceiroRecorrenciasPage } from "@/pages/FinanceiroRecorrenciasPage";
import { FinanceiroParceladosPage } from "@/pages/FinanceiroParceladosPage";
import { FinanceiroProvisoesPage } from "@/pages/FinanceiroProvisoesPage";
import { FinanceiroFrotaPage } from "@/pages/FinanceiroFrotaPage";
import { FrotaVeiculosPage } from "@/pages/FrotaVeiculosPage";
import { EscalaPage } from "@/pages/EscalaPage";
import { AgendaPage } from "@/pages/AgendaPage";
import { FrotaBiPage } from "@/pages/FrotaBiPage";
import { ProdutividadePage } from "@/pages/ProdutividadePage";
import { FrotaMapaPage } from "@/pages/FrotaMapaPage";
import { VeiculoPage } from "@/pages/VeiculoPage";
import { ChatPage } from "@/pages/ChatPage";
import { ClientesChatPage } from "@/pages/ClientesChatPage";
import { ProvedoresPage } from "@/pages/admin/ProvedoresPage";
import { ProvedorDetailPage } from "@/pages/admin/ProvedorDetailPage";
import { CategoriasPage } from "@/pages/admin/CategoriasPage";
import { UsuariosPage } from "@/pages/admin/UsuariosPage";
import { ModulosPage } from "@/pages/admin/ModulosPage";
import { CanaisWhatsappPage } from "@/pages/admin/CanaisWhatsappPage";
import { PerfilPage } from "@/pages/PerfilPage";

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <RealtimeProvider>
              <Routes>
                {/* Publicas: quem chega nelas nao tem (ou perdeu) a sessao. */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/recuperar-senha" element={<RecuperarSenhaPage />} />
                <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />
                <Route
                  path="/"
                  element={
                    <RequireAuth>
                      <PainelPage />
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
                <Route
                  path="/agenda"
                  element={
                    <RequireAuth roles={[UserRole.ADMIN, UserRole.GESTOR]}>
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
            </RealtimeProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
