import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { toast } from '../hooks/use-toast';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Debounce network error toasts so we don't spam the user
let _lastNetworkToast = 0;
function showNetworkError(title, description) {
  const now = Date.now();
  if (now - _lastNetworkToast < 5000) return;
  _lastNetworkToast = now;
  toast({ variant: 'destructive', title, description });
}

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
      // Clear auth state and redirect to login
      useAuthStore.getState().logout();

      // Avoid redirect loop on public auth pages
      const currentPath = window.location.pathname;
      if (
        currentPath !== '/login'
        && currentPath !== '/register'
        && currentPath !== '/reset-password'
        && currentPath !== '/admin/pin-reset'
      ) {
        window.location.href = '/login';
      }
    } else if (status >= 500) {
      showNetworkError('Erreur serveur', 'Le serveur a retourné une erreur. Réessayez dans quelques instants.');
    } else if (!error.response) {
      // Network error or timeout
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      showNetworkError(
        isTimeout ? 'Délai dépassé' : 'Erreur réseau',
        isTimeout
          ? 'La requête a pris trop de temps. Vérifiez votre connexion.'
          : 'Impossible de joindre le serveur. Vérifiez votre connexion.'
      );
    }

    return Promise.reject(error);
  }
);

export default api;
