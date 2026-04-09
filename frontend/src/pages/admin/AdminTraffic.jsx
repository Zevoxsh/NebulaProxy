import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Radio, RefreshCw, Trash2, Globe, Activity, Wifi, Server,
  MonitorDot, Filter, ChevronDown, Users, BarChart3
} from 'lucide-react';
import { adminAPI } from '../../api/client';
import { FlagImg } from '../../utils/flagCache';
import {
  AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent, AdminCardFooter,
  AdminStatCard, AdminButton, AdminBadge
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PaginationControls } from '@/components/ui/pagination-controls';

// ── helpers ─────────────────────────────────────────────────────────────────

const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const timeAgo = (ts) => {
  if (!ts) return '—';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5)  return 'à l\'instant';
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

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminTraffic() {
  const [connections, setConnections] = useState([]);
  const [stats, setStats]             = useState({ uniqueIps: 0, activeDomains: 0, totalReqs: 0 });
  const [loading, setLoading]         = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clearing, setClearing]       = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Filters
  const [filterDomain, setFilterDomain] = useState('');
  const [filterProto, setFilterProto]   = useState('');
  const [filterIp, setFilterIp]         = useState('');

  const intervalRef = useRef(null);

  const fetch = useCallback(async () => {
    try {
      const res = await adminAPI.getAdminLiveTraffic();
      setConnections(res.data.connections || []);
      setStats(res.data.stats || { uniqueIps: 0, activeDomains: 0, totalReqs: 0 });
    } catch (_) {
      // silently ignore — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetch, 4000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetch]);

  const handleClear = async () => {
    if (!confirm('Effacer toutes les connexions enregistrées ?')) return;
    setClearing(true);
    try {
      await adminAPI.clearAdminLiveTraffic();
      setConnections([]);
      setStats({ uniqueIps: 0, activeDomains: 0, totalReqs: 0 });
    } finally {
      setClearing(false);
    }
  };

  // Derived data
  const domains = [...new Set(connections.map(c => c.hostname).filter(Boolean))].sort();
  const protos  = [...new Set(connections.map(c => c.protocol).filter(Boolean))].sort();

  const filtered = connections.filter(c => {
    if (filterDomain && c.hostname !== filterDomain) return false;
    if (filterProto  && c.protocol !== filterProto)  return false;
    if (filterIp     && !c.ip?.includes(filterIp))   return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedConnections = filtered.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterDomain, filterProto, filterIp]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Per-protocol stats
  const protoCount = protos.reduce((acc, p) => {
    acc[p] = connections.filter(c => c.protocol === p).length;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-admin-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-admin-text flex items-center gap-2">
            <Radio className="w-6 h-6 text-admin-primary" strokeWidth={1.5} />
            Trafic en direct
          </h1>
          <p className="text-admin-text-muted text-sm mt-1">
            Connexions actives sur tous les domaines — rétention 30 jours
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AdminButton
            variant={autoRefresh ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${autoRefresh ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            {autoRefresh ? 'Live' : 'Pausé'}
          </AdminButton>
          <AdminButton variant="ghost" size="sm" onClick={fetch}>
            <RefreshCw className="w-4 h-4 mr-1.5" strokeWidth={1.5} />
            Rafraîchir
          </AdminButton>
          <AdminButton variant="danger" size="sm" onClick={handleClear} disabled={clearing}>
            <Trash2 className="w-4 h-4 mr-1.5" strokeWidth={1.5} />
            Effacer
          </AdminButton>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <AdminStatCard title="IPs uniques"     value={stats.uniqueIps}      icon={Users}      />
        <AdminStatCard title="Domaines actifs" value={stats.activeDomains}  icon={Globe}      />
        <AdminStatCard title="Total requêtes"  value={stats.totalReqs}      icon={BarChart3}  />
        {Object.entries(protoCount).map(([p, n]) => (
          <AdminCard key={p} className="relative overflow-hidden">
            <AdminCardContent className="p-4">
              <p className="text-admin-text-muted text-xs font-medium mb-1 uppercase">{p}</p>
              <p className="text-admin-text text-2xl font-bold">{n}</p>
              <p className="text-admin-text-muted text-xs mt-1">connexion(s)</p>
            </AdminCardContent>
          </AdminCard>
        ))}
      </div>

      {/* Filters */}
      <AdminCard>
        <AdminCardContent className="p-4">
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
              <AdminButton variant="ghost" size="sm" onClick={() => { setFilterIp(''); setFilterDomain(''); setFilterProto(''); setCurrentPage(1); }}>
                Réinitialiser
              </AdminButton>
            )}
            <span className="ml-auto text-xs text-admin-text-muted">
              {filtered.length} / {connections.length} entrée(s)
            </span>
          </div>
        </AdminCardContent>
      </AdminCard>

      {/* Table */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between">
            <AdminCardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4 text-admin-primary" strokeWidth={1.5} />
              Connexions récentes
            </AdminCardTitle>
            {autoRefresh && (
              <span className="text-[10px] text-admin-text-muted flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                Mise à jour toutes les 4s
              </span>
            )}
          </div>
        </AdminCardHeader>
        <AdminCardContent className="p-0">
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
                {paginatedConnections.map((c, i) => (
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
                    <TableCell className="text-xs text-admin-text-muted">{formatBytes(c.bytes)}</TableCell>
                    <TableCell className="text-xs text-admin-text-muted">{timeAgo(c.lastSeen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AdminCardContent>
        {filtered.length > 0 && (
          <AdminCardFooter className="px-6 py-2">
            <div className="w-full space-y-2">
              <p className="text-xs text-admin-text-muted">
                Les connexions sont conservées pendant 30 jours, puis supprimées automatiquement.
              </p>
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={itemsPerPage}
                onPageChange={setCurrentPage}
                label="connections"
                className="mt-0"
              />
            </div>
          </AdminCardFooter>
        )}
      </AdminCard>
    </div>
  );
}
