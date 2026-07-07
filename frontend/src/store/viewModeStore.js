import { create } from 'zustand';

/**
 * Client-side view mode: 'config' (domain/tunnel/team management) vs
 * 'visualization' (traffic/analytics/logs). Independent of the Admin/Client
 * split (which is a separate route tree) — this only filters what the
 * client sidebar and domain-detail tabs show.
 */
const STORAGE_KEY = 'client-view-mode';

export const useViewModeStore = create((set) => ({
  mode: localStorage.getItem(STORAGE_KEY) === 'visualization' ? 'visualization' : 'config',

  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    set({ mode });
  },
}));
