import { create } from 'zustand';
import { api } from '../services/api';

interface User {
  id: string;
  email: string;
  nom: string;
  prenom: string;
  role: string;
  entiteId?: string;
  /** Niveaux par module (clés alignées API) : none | lecture | modification */
  uiModules?: Record<string, string>;
}

interface AuthState {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
  loadFromStorage: () => void;
  /** Recharge profil + uiModules (ex. après modif admin ou session ancienne). */
  refreshProfile: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token'),
  login: async (email: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token, refreshToken, user } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      set({ user, token });
    } catch (error: any) {
      // Propager l'erreur avec toutes ses informations
      throw error;
    }
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    delete (api.defaults.headers.common as any).Authorization;
    set({ user: null, token: null });
  },
  isAuthenticated: () => {
    return !!get().token;
  },
  loadFromStorage: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      set({ token, user: JSON.parse(userStr) });
    }
  },
  refreshProfile: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const response = await api.get('/auth/me');
      const u = response.data?.user;
      if (u) {
        localStorage.setItem('user', JSON.stringify(u));
        set({ user: u });
      }
    } catch {
      // session invalide : ne pas forcer logout ici (intercepteur gère 401)
    }
  },
}));
