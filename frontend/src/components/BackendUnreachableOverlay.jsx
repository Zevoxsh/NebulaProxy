import { useEffect, useRef } from 'react';
import { Server } from 'lucide-react';
import { useConnectivityStore } from '../store/connectivityStore';
import { statusAPI } from '../api/client';

const POLL_MS = 2000;

// App-wide "reconnecting" takeover — mounted once at the root in App.jsx so
// it persists across route changes. Since it never navigates anywhere, the
// underlying route is untouched: once the backend answers again, whatever
// page was already on screen just resumes, which is the whole point (no
// separate "remember where I was" logic needed).
export default function BackendUnreachableOverlay() {
  const backendUnreachable = useConnectivityStore((s) => s.backendUnreachable);
  const setBackendUnreachable = useConnectivityStore((s) => s.setBackendUnreachable);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!backendUnreachable) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return undefined;
    }

    pollRef.current = setInterval(async () => {
      try {
        await statusAPI.getStatus();
        setBackendUnreachable(false);
      } catch {
        // Still down — keep waiting, the interval just fires again.
      }
    }, POLL_MS);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [backendUnreachable, setBackendUnreachable]);

  if (!backendUnreachable) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0B0C0F] flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="mx-auto w-16 h-16 rounded-full bg-[#9D4EDD]/10 border border-[#9D4EDD]/25 flex items-center justify-center mb-5 relative">
          <Server className="w-8 h-8 text-[#9D4EDD]" />
          <span className="absolute inset-0 rounded-full border-2 border-[#9D4EDD]/40 animate-ping" />
        </div>
        <h1 className="text-lg font-light text-white">Connexion au serveur perdue</h1>
        <p className="text-sm text-white/50 mt-2">
          Reconnexion automatique en cours — la page reprendra dès que le serveur répond.
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[#9D4EDD] animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
