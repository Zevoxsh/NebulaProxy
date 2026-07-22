import { create } from 'zustand';

// Global flag flipped by the axios response interceptor (src/api/instance.js)
// whenever any request fails with no response at all (backend unreachable —
// mid-restart, network blip, etc.), and cleared as soon as any request
// succeeds again. Drives the app-wide BackendUnreachableOverlay instead of
// spamming a red toast per failed request, and lets the initial auth check
// distinguish "server said no" (401) from "couldn't even reach the server".
export const useConnectivityStore = create((set) => ({
  backendUnreachable: false,
  setBackendUnreachable: (value) => set({ backendUnreachable: value })
}));
