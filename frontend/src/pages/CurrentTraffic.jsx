import { useState, useEffect, useCallback, useRef } from 'react';
import { Zap, RefreshCw, Globe, Activity, Wifi, Filter } from 'lucide-react';
import { domainAPI } from '../api/client';
import { FlagImg } from '../utils/flagCache';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const timeAgo = (ts) => {
  if (!ts) return '—';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 2)  return "à l'instant";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}min`;
};

const recencyClass = (ts) => {
  if (!ts) return 'text-admin-text-muted';
  const sec = (Date.now() - ts) / 1000;
  if (sec < 5)  return 'text-green-400';
  if (sec < 15) return 'text-yellow-400';
  return 'text-admin-text-muted';
};

const PROTO_COLORS = {
  http:      'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  https:     'bg-cyan-500/10  text-cyan-400  border border-cyan-500/20',
  tcp:       'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  udp:       'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  minecraft: 'bg-green-500/10 text-green-400 border border-green-500/20',
};

function ProtoBadge({ proto }) {
  const cls = PROTO_COLORS[proto] || 'bg-white/5 text-white/40 border border-white/10';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {proto}
    </span>
  );
}

// Window: only show connections seen in the last 60 seconds
const CURRENT_WINDOW_MS = 60 * 1000;

// ── Component ─────────────────────────────────────────────────────────────────

export default function CurrentTraffic() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow]                 = useState(Date.now());

  // Filters
  const [filterDomain, setFilterDomain] = useState('');
  const [filterProto,  setFilterProto]  = useState('');
  const [filterIp,     setFilterIp]     = useState('');

  const intervalRef  = useRef(null);
  const clockRef     = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await domainAPI.getAllLiveTraffic();
      const all = res.data.connections || [];
      const threshold = Date.now() - CURRENT_WINDOW_MS;
      // Only keep connections seen in the last 60 seconds
      setConnections(all.filter(c => c.lastSeen > threshold));
    } catch (_) {
      // silently ignore — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data every 1 second
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, load]);

  // Clock tick for live recency colors (every second)
  useEffect(() => {
    clockRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clockRef.current);
  }, []);

  // Derived
  const domains = [...new Set(connections.map(c => c.hostname).filter(Boolean))].sort();
  const protos  = [...new Set(connections.map(c => c.protocol).filter(Boolean))].sort();

  const filtered = connections.filter(c => {
    if (filterDomain && c.hostname !== filterDomain) return false;
    if (filterProto  && c.protocol !== filterProto)  return false;
    if (filterIp     && !c.ip?.includes(filterIp))   return false;
    return true;
  });

  // Sort: most recently seen first
  const sorted = [...filtered].sort((a, b) => b.lastSeen - a.lastSeen);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#9D4EDD]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-admin-text flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#9D4EDD]" strokeWidth={1.5} />
            Requêtes actuelles
          </h1>
          <p className="text-admin-text-muted text-sm mt-1">
            Connexions des 60 dernières secondes — rafraîchissement 1s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              autoRefresh
                ? 'bg-[#9D4EDD]/15 text-[#9D4EDD] border-[#9D4EDD]/30'
                : 'bg-admin-surface border-admin-border text-admin-text-muted hover:bg-admin-surface2'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            {autoRefresh ? 'Live' : 'Pausé'}
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-admin-surface border border-admin-border text-admin-text-muted hover:bg-admin-surface2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Rafraîchir
          </button>
        </div>
      </div>

      {/* Counter bar */}
      <div className="card-standard p-4 flex items-center gap-4">
        <Activity className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
        <span className="text-admin-text font-semibold text-lg">{sorted.length}</span>
        <span className="text-admin-text-muted text-sm">connexion(s) active(s) dans la fenêtre de 60s</span>
        {autoRefresh && (
          <span className="ml-auto text-[10px] text-admin-text-muted flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            Mise à jour en temps réel
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="card-standard p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-admin-text-muted flex-shrink-0" strokeWidth={1.5} />
          <Input
            placeholder="Filtrer par IP..."
            value={filterIp}
            onChange={e => setFilterIp(e.target.value)}
            className="bg-admin-bg border-admin-border text-admin-text text-xs w-44 h-8"
          />
          <select
            value={filterDomain}
            onChange={e => setFilterDomain(e.target.value)}
            className="h-8 text-xs px-3 py-1 bg-admin-bg border border-admin-border rounded-md text-admin-text focus:outline-none"
          >
            <option value="">Tous les domaines</option>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select
            value={filterProto}
            onChange={e => setFilterProto(e.target.value)}
            className="h-8 text-xs px-3 py-1 bg-admin-bg border border-admin-border rounded-md text-admin-text focus:outline-none"
          >
            <option value="">Tous les protocoles</option>
            {protos.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
          {(filterIp || filterDomain || filterProto) && (
            <button
              onClick={() => { setFilterIp(''); setFilterDomain(''); setFilterProto(''); }}
              className="text-xs text-admin-text-muted hover:text-admin-text transition-colors"
            >
              Réinitialiser
            </button>
          )}
          <span className="ml-auto text-xs text-admin-text-muted">
            {sorted.length} entrée(s)
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card-standard overflow-hidden p-0">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-admin-border">
          <Zap className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
          <h2 className="text-admin-text font-semibold text-sm">Flux en direct</h2>
          <span className="text-xs text-admin-text-muted ml-1">— vert = &lt;5s, jaune = &lt;15s</span>
        </div>

        {sorted.length === 0 ? (
          <div className="p-12 text-center text-admin-text-muted text-sm">
            <Wifi className="w-10 h-10 mx-auto mb-3 opacity-20" strokeWidth={1} />
            Aucune requête dans les 60 dernières secondes
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-admin-border">
                <TableHead className="text-admin-text-muted text-xs w-4" />
                <TableHead className="text-admin-text-muted text-xs">IP</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Pays</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Domaine</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Protocole</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Backend</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Req</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Data</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Dernier hit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c, i) => (
                <TableRow key={`${c.ip}-${c.protocol}-${c.domainId}-${i}`} className="border-admin-border">
                  <TableCell className="pr-0">
                    <span className={`w-2 h-2 rounded-full inline-block ${recencyClass(c.lastSeen).replace('text-', 'bg-')}`} />
                  </TableCell>
                  <TableCell className="font-mono text-sm text-admin-text">{c.ip}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {c.country
                        ? <FlagImg code={c.country} title={c.country} className="w-5 h-3.5 rounded-sm" />
                        : <Globe className="w-4 h-4 text-admin-text-muted opacity-40" strokeWidth={1.5} />
                      }
                      <span className="text-xs text-admin-text-muted font-mono">{c.country || '—'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-admin-text max-w-[160px] truncate">
                    {c.hostname || <span className="text-admin-text-muted italic">—</span>}
                  </TableCell>
                  <TableCell><ProtoBadge proto={c.protocol} /></TableCell>
                  <TableCell className="text-xs text-admin-text-muted font-mono max-w-[140px] truncate">
                    {c.backend || '—'}
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-admin-text">{c.reqCount}</TableCell>
                  <TableCell className="text-xs text-admin-text-muted">{fmtBytes(c.bytes)}</TableCell>
                  <TableCell className={`text-xs font-mono ${recencyClass(c.lastSeen)}`}>
                    {timeAgo(c.lastSeen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
