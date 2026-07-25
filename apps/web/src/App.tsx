import { BrowserRouter, Routes, Route } from "react-router-dom";
import { UserRole } from "@isphub/shared";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { RequireAuth } from "@/routes/RequireAuth";
import { LoginPage } from "@/pages/LoginPage";
import { PainelPage } from "@/pages/PainelPage";
import { MapaPage } from "@/pages/MapaPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProvedoresPage } from "@/pages/admin/ProvedoresPage";
import { ProvedorDetailPage } from "@/pages/admin/ProvedorDetailPage";
import { CategoriasPage } from "@/pages/admin/CategoriasPage";

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
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
                path="/dashboard"
                element={
                  <RequireAuth>
                    <DashboardPage />
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
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
