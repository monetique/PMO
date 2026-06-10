import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur pour ajouter le token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Laisser le navigateur poser multipart + boundary ; sinon Multer ne reçoit pas les champs.
  if (config.data instanceof FormData && config.headers) {
    const headers = config.headers as { delete?: (k: string) => void } & Record<string, unknown>;
    if (typeof headers.delete === 'function') headers.delete('Content-Type');
    else {
      delete headers['Content-Type'];
      delete headers['content-type'];
    }
  }
  return config;
});

// Variable pour éviter les boucles infinies de rafraîchissement
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: any) => void; reject: (reason?: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Intercepteur pour gérer les erreurs et le rafraîchissement du token
api.interceptors.response.use(
  (response) => {
    const d = response.data;
    if (typeof d === 'string' && /^\s*</.test(d)) {
      console.error(
        '[api] Réponse HTML reçue au lieu de JSON — vérifiez nginx (proxy /api/ vers l’API) ou VITE_API_URL.'
      );
      return Promise.reject(new Error('Réponse invalide (HTML au lieu de JSON)'));
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Si l'erreur est 401 et qu'on n'a pas déjà tenté de rafraîchir
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Ne pas rediriger si on est déjà sur la page de login
      const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';
      if (isLoginPage) {
        return Promise.reject(error);
      }

      // Si on est déjà en train de rafraîchir, mettre la requête en queue
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        // Pas de refresh token, déconnexion
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        processQueue(error, null);
        isRefreshing = false;
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        // Essayer de rafraîchir le token (utiliser axios directement pour éviter la boucle)
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        }, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const { token: newToken } = response.data;
        localStorage.setItem('token', newToken);
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
        originalRequest.headers.Authorization = `Bearer ${newToken}`;

        processQueue(null, newToken);
        isRefreshing = false;

        // Réessayer la requête originale avec le nouveau token
        return api(originalRequest);
      } catch (refreshError) {
        // Le rafraîchissement a échoué, déconnexion
        processQueue(refreshError, null);
        isRefreshing = false;
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Pour les erreurs 403, on les rejette silencieusement (sans log dans la console)
    // Le message sera géré par les handlers dans les composants
    if (error.response?.status === 403) {
      // On retourne l'erreur mais sans que axios la logge automatiquement
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);
