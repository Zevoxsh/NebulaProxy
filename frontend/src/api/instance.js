import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useConnectivityStore } from '../store/connectivityStore';
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
  (response) => {
    // Any successful round-trip proves the backend is reachable again —
    // clear the flag immediately rather than waiting for the overlay's own
    // poll tick.
    if (useConnectivityStore.getState().backendUnreachable) {
      useConnectivityStore.getState().setBackendUnreachable(false);
    }
    return response;
  },
  (error) => {
    const status = error.response?.status;

    if (status === 423) {
      // Admin PIN required or expired — fire a custom event so AdminLayout
      // can show the PIN dialog without prop-drilling through the component tree.
      window.dispatchEvent(new CustomEvent('admin-pin-required'));
    } else if (status === 401) {
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
      // No response at all — backend unreachable (restart, network blip,
      // timeout). Drives the app-wide BackendUnreachableOverlay instead of a
      // red toast per failed request: a container restart triggers many
      // in-flight/polling requests failing at once, which used to spam this
      // toast repeatedly and — for the initial auth check specifically —
      // looked identical to a real 401, logging the user out on an F5 during
      // a restart. See App.jsx's verifyAuth for the other half of that fix.
      useConnectivityStore.getState().setBackendUnreachable(true);
    }

    return Promise.reject(error);
  }
);

export default api;
