import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, RefreshCw, Globe, Activity, Wifi, Users, BarChart3, Filter } from 'lucide-react';
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
  if (sec < 5)  return "à l'instant";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}min`;
  return `${Math.floor(sec / 3600)}h`;
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function RealtimeTraffic() {
  const [connections, setConnections] = useState([]);
  const [stats, setStats]             = useState({ uniqueIps: 0, activeDomains: 0, totalReqs: 0 });
  const [loading, setLoading]         = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters
  const [filterDomain, setFilterDomain] = useState('');
  const [filterProto,  setFilterProto]  = useState('');
  const [filterIp,     setFilterIp]     = useState('');

  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await domainAPI.getAllLiveTraffic();
      setConnections(res.data.connections || []);
      setStats(res.data.stats || { uniqueIps: 0, activeDomains: 0, totalReqs: 0 });
    } catch (_) {
      // silently ignore — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 4000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, load]);

  // Derived
  const domains = [...new Set(connections.map(c => c.hostname).filter(Boolean))].sort();
  const protos  = [...new Set(connections.map(c => c.protocol).filter(Boolean))].sort();

  const filtered = connections.filter(c => {
    if (filterDomain && c.hostname !== filterDomain) return false;
    if (filterProto  && c.protocol !== filterProto)  return false;
    if (filterIp     && !c.ip?.includes(filterIp))   return false;
    return true;
  });

  const protoCount = protos.reduce((acc, p) => {
    acc[p] = connections.filter(c => c.protocol === p).length;
    return acc;
  }, {});

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
            <Radio className="w-6 h-6 text-[#9D4EDD]" strokeWidth={1.5} />
            Trafic en direct
          </h1>
          <p className="text-admin-text-muted text-sm mt-1">
            Connexions actives sur tous vos domaines — fenêtre glissante 5 min
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="card-standard p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
            <p className="text-admin-text-muted text-xs font-medium uppercase tracking-wide">IPs uniques</p>
          </div>
          <p className="text-admin-text text-2xl font-bold">{stats.uniqueIps}</p>
        </div>
        <div className="card-standard p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
            <p className="text-admin-text-muted text-xs font-medium uppercase tracking-wide">Domaines actifs</p>
          </div>
          <p className="text-admin-text text-2xl font-bold">{stats.activeDomains}</p>
        </div>
        <div className="card-standard p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
            <p className="text-admin-text-muted text-xs font-medium uppercase tracking-wide">Total requêtes</p>
          </div>
          <p className="text-admin-text text-2xl font-bold">{stats.totalReqs}</p>
        </div>
        {Object.entries(protoCount).map(([p, n]) => (
          <div key={p} className="card-standard p-4">
            <p className="text-admin-text-muted text-xs font-medium mb-1 uppercase">{p}</p>
            <p className="text-admin-text text-2xl font-bold">{n}</p>
            <p className="text-admin-text-muted text-xs mt-1">connexion(s)</p>
          </div>
        ))}
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
            {filtered.length} / {connections.length} entrée(s)
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card-standard overflow-hidden p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-admin-border">
          <h2 className="flex items-center gap-2 text-admin-text font-semibold text-sm">
            <Activity className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
            Connexions récentes
          </h2>
          {autoRefresh && (
            <span className="text-[10px] text-admin-text-muted flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
              Mise à jour toutes les 4s
            </span>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-admin-text-muted text-sm">
            <Wifi className="w-10 h-10 mx-auto mb-3 opacity-20" strokeWidth={1} />
            {connections.length === 0
              ? 'Aucune connexion enregistrée — le trafic apparaîtra ici automatiquement'
              : 'Aucun résultat pour ce filtre'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-admin-border">
                <TableHead className="text-admin-text-muted text-xs">IP</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Pays</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Domaine</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Protocole</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Backend</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Requêtes</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Data</TableHead>
                <TableHead className="text-admin-text-muted text-xs">Dernier hit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c, i) => (
                <TableRow key={`${c.ip}-${c.protocol}-${c.domainId}-${i}`} className="border-admin-border">
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
                  <TableCell className="text-xs text-admin-text-muted font-mono max-w-[160px] truncate">
                    {c.backend || '—'}
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-admin-text">{c.reqCount}</TableCell>
                  <TableCell className="text-xs text-admin-text-muted">{fmtBytes(c.bytes)}</TableCell>
                  <TableCell className="text-xs text-admin-text-muted">{timeAgo(c.lastSeen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {filtered.length > 0 && (
          <div className="px-6 py-3 border-t border-admin-border">
            <p className="text-xs text-admin-text-muted">
              Les connexions sans activité depuis plus de 5 minutes disparaissent automatiquement.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
