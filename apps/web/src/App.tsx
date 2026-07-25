import { BrowserRouter, Routes, Route } from "react-router-dom";
import { UserRole } from "@isphub/shared";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { RequireAuth } from "@/routes/RequireAuth";
import { LoginPage } from "@/pages/LoginPage";
import { PainelPage } from "@/pages/PainelPage";
import { MapaPage } from "@/pages/MapaPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProvedoresPage } from "@/pages/admin/ProvedoresPage";
import { ProvedorDetailPage } from "@/pages/admin/ProvedorDetailPage";

function App() {
  return (
    <BrowserRouter>
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
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
