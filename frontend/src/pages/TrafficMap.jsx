import { useState, useEffect, useRef } from 'react';
import { MapPin, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { analyticsAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { LiveWorldMap, toLngLat } from './WorldTrafficMap';
import { COUNTRY_COORDINATES } from '../utils/countryCoordinates';

const MAX_PULSES = 40;
const PULSE_TTL_MS = 1600;
const VOLUME_WINDOW_MS = 30_000;

export default function TrafficMap() {
  const user = useAuthStore((s) => s.user);

  const [wsStatus, setWsStatus] = useState('connecting');
  const [totalReqs, setTotalReqs] = useState(0);
  const [pulses, setPulses] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [proxyLocation, setProxyLocation] = useState(null);

  const pulseIdRef = useRef(0);
  const eventLogRef = useRef({}); // { [country]: number[] timestamps }

  // Recompute per-country volume over a trailing window every second —
  // gives a "current activity" heatmap instead of an ever-growing total.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const log = eventLogRef.current;
      const next = [];
      for (const country of Object.keys(log)) {
        const recent = log[country].filter((ts) => now - ts <= VOLUME_WINDOW_MS);
        if (recent.length === 0) { delete log[country]; continue; }
        log[country] = recent;
        const coords = COUNTRY_COORDINATES[country];
        if (coords) next.push({ country, count: recent.length, position: toLngLat(coords) });
      }
      setVolumes(next);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Server location barely ever changes — fetch once.
  useEffect(() => {
    analyticsAPI.getProxyLocation()
      .then((res) => setProxyLocation(res.data))
      .catch(() => setProxyLocation(null));
  }, []);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/notifications`;
    let ws, reconnectTimeout, unmounted = false;

    function connect() {
      setWsStatus('connecting');
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setWsStatus('connected');
        if (user?.id) ws.send(JSON.stringify({ type: 'subscribe', userId: String(user.id) }));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'traffic_log' && msg.payload?.domainId) {
            setTotalReqs((n) => n + 1);

            const country = msg.payload.country;
            const coords = country && COUNTRY_COORDINATES[country];
            if (coords) {
              if (!eventLogRef.current[country]) eventLogRef.current[country] = [];
              eventLogRef.current[country].push(Date.now());

              const id = ++pulseIdRef.current;
              const pulse = { id, country, position: toLngLat(coords), level: msg.payload.level };
              setPulses((prev) => {
                const next = [...prev, pulse];
                return next.length > MAX_PULSES ? next.slice(next.length - MAX_PULSES) : next;
              });
              setTimeout(() => {
                setPulses((prev) => prev.filter((p) => p.id !== id));
              }, PULSE_TTL_MS);
            }
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setWsStatus('disconnected');
        if (!unmounted) reconnectTimeout = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { unmounted = true; clearTimeout(reconnectTimeout); if (ws) ws.close(); };
  }, [user?.id]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">Carte du trafic</h1>
              <p className="text-sm text-white/50 font-light mt-1">Une ligne animée par requête entrante, en direct</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {wsStatus === 'connected' && (
                <span className="flex items-center gap-2 text-[#10B981]">
                  <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
                  <Wifi className="w-4 h-4" strokeWidth={1.5} />
                  <span className="font-medium">Live</span>
                </span>
              )}
              {wsStatus === 'connecting' && (
                <span className="flex items-center gap-2 text-[#F59E0B]">
                  <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                  <span>Connecting…</span>
                </span>
              )}
              {wsStatus === 'disconnected' && (
                <span className="flex items-center gap-2 text-[#EF4444]">
                  <WifiOff className="w-4 h-4" strokeWidth={1.5} />
                  <span>Disconnected — reconnecting…</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
              style={{ background: '#38BDF818', borderColor: '#38BDF844' }}>
              <MapPin className="w-4 h-4 text-[#38BDF8]" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-white">Origine du trafic</p>
            <span className="ml-auto text-xs text-white/30">
              {totalReqs > 0 ? `${totalReqs.toLocaleString()} requêtes depuis l'ouverture · volume sur les 30 dernières secondes` : 'en attente de trafic'}
            </span>
          </div>
          <div className="p-4">
            <LiveWorldMap pulses={pulses} volumes={volumes} proxyLocation={proxyLocation} />
          </div>
        </div>
      </div>
    </div>
  );
}
