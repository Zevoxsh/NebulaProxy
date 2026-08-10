import { create } from 'zustand';

/**
 * Branding store — holds the configurable application name.
 * Fetched once on app start from /api/admin/branding (public endpoint).
 */
export const useBrandingStore = create((set, get) => ({
  appName: 'NebulaProxy',
  loaded: false,

  setAppName: (name) => set({ appName: name || 'NebulaProxy' }),

  fetchBranding: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/admin/branding');
      if (res.ok) {
        const data = await res.json();
        set({ appName: data.appName || 'NebulaProxy', loaded: true });
      }
    } catch {
      // Keep default
      set({ loaded: true });
    }
  }
}));
