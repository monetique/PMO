import { Link, useNavigate, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import { useAuth } from '../store/auth';
import { navPathToUiModule, isUiModuleAllowed } from '../utils/uiModuleRoute';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isAdmin = user?.role === 'admin';

  const allNavItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/processus', label: 'Processus' },
    { path: '/projets', label: 'Projets' },
    { path: '/taches', label: 'Epics / User story / Tâches' },
    { path: '/calendrier', label: 'Calendrier' },
    { path: '/clients-fournisseurs', label: 'Clients / Fournisseurs' },
    { path: '/contrats', label: 'Contrats' },
    { path: '/pv-reunion', label: 'PV de réunion' },
    { path: '/ocr', label: 'OCR' },
    { path: '/licences', label: 'Licences / Certifications' },
    { path: '/entites', label: 'Entités' },
    { path: '/documents', label: 'Documents' },
    ...(isAdmin ? [
      { path: '/users', label: 'Utilisateurs' },
      { path: '/journal', label: 'Journal' },
      { path: '/configuration', label: 'Configuration' },
      { path: '/corbeille', label: 'Corbeille' },
    ] : []),
  ];

  const navItems = allNavItems.filter((item) => {
    const mod = navPathToUiModule(item.path);
    return isUiModuleAllowed(user?.uiModules, mod);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="mx-auto px-4 sm:px-6 lg:px-8">
          {/* Ligne 1 : Titre + Profil */}
          <div className="flex justify-between items-center py-2 border-b border-gray-100">
            <h1 className="text-lg font-bold text-blue-700 tracking-wide">PMO - HUB</h1>
            <NotificationBell />
              <div className="relative group">
              <button className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold uppercase">
                  {user?.prenom?.[0]}{user?.nom?.[0]}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-sm font-medium text-gray-700">{user?.prenom} {user?.nom}</p>
                  <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
                </div>
              </button>
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">{user?.prenom} {user?.nom}</p>
                  <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
                </div>
                <Link to="/profile" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">👤 Mon profil</Link>
                <hr className="my-1" />
                <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">🚪 Déconnexion</button>
              </div>
            </div>
          </div>
          {/* Ligne 2 : Navigation */}
          <div className="flex overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`whitespace-nowrap py-3 px-3 border-b-2 text-sm font-medium flex-shrink-0 ${
                  location.pathname === item.path ||
                  (item.path === '/projets' && location.pathname.startsWith('/projets')) ||
                  (item.path === '/clients-fournisseurs' && location.pathname.startsWith('/clients-fournisseurs')) ||
                  (item.path === '/taches' && location.pathname.startsWith('/taches')) ||
                  (item.path === '/calendrier' && location.pathname.startsWith('/calendrier')) ||
                  (item.path === '/pv-reunion' && location.pathname.startsWith('/pv-reunion'))
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
