import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './store/auth';
import { pathnameToUiModule, isUiModuleAllowed } from './utils/uiModuleRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Processus from './pages/Processus';
import ProcessusDetail from './pages/ProcessusDetail';
import Entites from './pages/Entites';
import EntiteDetail from './pages/EntiteDetail';
import Documents from './pages/Documents';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Profile from './pages/Profile';
import Journal from './pages/Journal';
import Configuration from './pages/Configuration';
import ClientsFournisseurs from './pages/ClientsFournisseurs';
import Contrats from './pages/Contrats';
import OCR from './pages/OCR';
import Licences from './pages/Licences';
import Projets from './pages/Projets';
import Taches from './pages/Taches';           // ← NOUVEAU
import Calendrier from './pages/Calendrier';
import ProjetDetail from './pages/ProjetDetail'; // ← NOUVEAU (déjà existant, maintenant complet)
import Corbeille from './pages/Corbeille';
import PvReunionList from './pages/PvReunionList';
import PvReunionDetail from './pages/PvReunionDetail';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { isAuthenticated, loadFromStorage, user, refreshProfile } = useAuth();
  const location = useLocation();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isAuthenticated() || !user) return;
    if (!user.uiModules || Object.keys(user.uiModules).length === 0) {
      refreshProfile();
    }
  }, [isAuthenticated, user, refreshProfile]);

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  const mod = pathnameToUiModule(location.pathname);
  if (user && !isUiModuleAllowed(user.uiModules, mod)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loadFromStorage } = useAuth();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  if (isAuthenticated()) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />

        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

        <Route path="/processus" element={<ProtectedRoute><Processus /></ProtectedRoute>} />
        <Route path="/processus/:id" element={<ProtectedRoute><ProcessusDetail /></ProtectedRoute>} />

        <Route path="/entites" element={<ProtectedRoute><Entites /></ProtectedRoute>} />
        <Route path="/entites/:id" element={<ProtectedRoute><EntiteDetail /></ProtectedRoute>} />

        <Route path="/documents" element={<ProtectedRoute><Documents /></ProtectedRoute>} />
        <Route path="/pv-reunion" element={<ProtectedRoute><PvReunionList /></ProtectedRoute>} />
        <Route path="/pv-reunion/:id" element={<ProtectedRoute><PvReunionDetail /></ProtectedRoute>} />

        {/* NOUVEAU - Routes Projets */}
        <Route path="/projets" element={<ProtectedRoute><Projets /></ProtectedRoute>} />
        <Route path="/projets/:id" element={<ProtectedRoute><ProjetDetail /></ProtectedRoute>} />
        <Route path="/taches" element={<ProtectedRoute><Taches /></ProtectedRoute>} />
        <Route path="/calendrier" element={<ProtectedRoute><Calendrier /></ProtectedRoute>} />
        <Route path="/clients-fournisseurs" element={<ProtectedRoute><ClientsFournisseurs /></ProtectedRoute>} />
        <Route path="/contrats" element={<ProtectedRoute><Contrats /></ProtectedRoute>} />
              <Route path="/ocr" element={<ProtectedRoute><OCR /></ProtectedRoute>} />
              <Route path="/licences" element={<ProtectedRoute><Licences /></ProtectedRoute>} />

        <Route path="/users" element={<ProtectedRoute allowedRoles={['admin']}><Users /></ProtectedRoute>} />
        <Route path="/users/:id" element={<ProtectedRoute allowedRoles={['admin']}><UserDetail /></ProtectedRoute>} />

        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        <Route path="/journal" element={<ProtectedRoute allowedRoles={['admin']}><Journal /></ProtectedRoute>} />
        <Route path="/configuration" element={<ProtectedRoute allowedRoles={['admin']}><Configuration /></ProtectedRoute>} />
        <Route path="/corbeille" element={<ProtectedRoute allowedRoles={['admin']}><Corbeille /></ProtectedRoute>} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
