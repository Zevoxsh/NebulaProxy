import { create } from 'zustand';

/**
 * Authentication store
 *
 * SECURITY: Does NOT use localStorage persistence
 * Authentication relies on httpOnly cookies set by the backend
 * User data is stored in memory only and retrieved from the server on app load
 */
export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,

  setUser: (user) => set({
    user,
    isAuthenticated: true
  }),

  logout: () => {
    set({
      user: null,
      isAuthenticated: false
    });
  },

  updateUser: (userData) => set((state) => ({
    user: { ...state.user, ...userData }
  }))
}));
