import { useState, useEffect, useCallback } from 'react';
import {
  Activity, Globe, Zap, Database, TrendingUp, AlertCircle,
  RefreshCw, BarChart3, Monitor, Shield, Clock, ChevronDown
} from 'lucide-react';
import { analyticsAPI, logsAPI } from '../api/client';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(1, bytes)) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function pct(v, total) {
  if (!total) return 0;
  return ((v / total) * 100).toFixed(1);
}

const TIME_RANGES = [
  { value: '1h', label: '1 heure' },
  { value: '24h', label: '24 heures' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' }
];

const STATUS_COLOR = {
  '2xx': { bar: 'bg-[#10B981]', text: 'text-[#34D399]', badge: 'bg-[#10B981]/15 border-[#10B981]/30 text-[#34D399]' },
  '3xx': { bar: 'bg-[#22D3EE]', text: 'text-[#22D3EE]', badge: 'bg-[#22D3EE]/15 border-[#22D3EE]/30 text-[#22D3EE]' },
  '4xx': { bar: 'bg-[#F59E0B]', text: 'text-[#FBBF24]', badge: 'bg-[#F59E0B]/15 border-[#F59E0B]/30 text-[#FBBF24]' },
  '5xx': { bar: 'bg-[#EF4444]', text: 'text-[#F87171]', badge: 'bg-[#EF4444]/15 border-[#EF4444]/30 text-[#F87171]' }
};

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = '#9D4EDD' }) {
  return (
    <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-white/[0.14] transition-all duration-400">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center border flex-shrink-0"
          style={{ background: `${color}18`, borderColor: `${color}44` }}>
          <Icon className="w-6 h-6" style={{ color }} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1 truncate">{label}</p>
          <p className="text-xl font-light text-white tracking-tight truncate">{value}</p>
          {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Panel container ──────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, children, action, color = '#9D4EDD' }) {
  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
            style={{ background: `${color}18`, borderColor: `${color}44` }}>
            <Icon className="w-4 h-4" style={{ color }} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-white">{title}</p>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Mini bar chart for traffic ───────────────────────────────────────────────
function MiniBarChart({ data, valueKey = 'requests' }) {
  if (!data || data.length === 0) return <p className="text-xs text-white/40 text-center py-4">Aucune donnée</p>;
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div className="flex items-end gap-0.5 h-24 w-full">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full bg-[#9D4EDD]/40 hover:bg-[#C77DFF]/60 rounded-sm transition-colors duration-200 cursor-default"
            style={{ height: `${Math.max(2, (d[valueKey] / max) * 100)}%` }}
          />
          <div className="absolute bottom-full mb-1 bg-[#1A1B28] border border-white/[0.12] rounded px-2 py-1 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 left-1/2 -translate-x-1/2">
            {d.time}: {d[valueKey]}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Horizontal bar row ───────────────────────────────────────────────────────
function HBar({ label, value, max, sub, color = 'bg-[#9D4EDD]', badge }) {
  const pctVal = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/80 truncate mr-2 font-mono max-w-[60%]">{label}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {badge && <span className={`px-2 py-0.5 rounded-full text-[10px] border ${badge}`}>{sub}</span>}
          {!badge && <span className="text-white/50">{value.toLocaleString()}</span>}
        </div>
      </div>
      <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pctVal}%` }} />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [timeRange, setTimeRange] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [stats, setStats] = useState(null);
  const [traffic, setTraffic] = useState([]);
  const [topDomains, setTopDomains] = useState([]);
  const [topIps, setTopIps] = useState([]);
  const [topPaths, setTopPaths] = useState([]);
  const [statusCodes, setStatusCodes] = useState({ distribution: [], groups: {} });
  const [topAgents, setTopAgents] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsR, trafficR, domainsR, ipsR, pathsR, statusR, agentsR] = await Promise.all([
        analyticsAPI.getStats(timeRange),
        analyticsAPI.getTraffic(timeRange),
        analyticsAPI.getTopDomains(timeRange, 10),
        analyticsAPI.getTopIps(timeRange, 15),
        analyticsAPI.getTopPaths(timeRange, 15),
        analyticsAPI.getStatusCodes(timeRange),
        analyticsAPI.getTopUserAgents(timeRange, 10)
      ]);
      setStats(statsR.data);
      setTraffic(trafficR.data.data || []);
      setTopDomains(domainsR.data.domains || []);
      setTopIps(ipsR.data.ips || []);
      setTopPaths(pathsR.data.paths || []);
      setStatusCodes(statusR.data || { distribution: [], groups: {} });
      setTopAgents(agentsR.data.agents || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger les analytics');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { load(); }, [load]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const res = await logsAPI.exportCsv({ limit: 10000 });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  };

  const maxReq = Math.max(...topDomains.map(d => d.requests), 1);
  const maxIpReq = Math.max(...topIps.map(d => d.requests), 1);
  const maxPathReq = Math.max(...topPaths.map(d => d.requests), 1);
  const maxAgent = Math.max(...topAgents.map(d => d.requests), 1);
  const totalStatus = Object.values(statusCodes.groups || {}).reduce((s, v) => s + v, 0);

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">Analytics</h1>
              <p className="text-sm text-white/50 font-light mt-1">Métriques de trafic et performances</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Time range selector */}
              <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.08] rounded-lg p-1">
                {TIME_RANGES.map(tr => (
                  <button
                    key={tr.value}
                    onClick={() => setTimeRange(tr.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-light transition-all duration-300 ${
                      timeRange === tr.value
                        ? 'bg-[#9D4EDD]/30 text-white border border-[#9D4EDD]/40'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>

              <button
                onClick={load}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/70 hover:text-white rounded-lg text-sm font-light transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                Actualiser
              </button>

              <button
                onClick={handleExportCsv}
                disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border border-white/[0.08] hover:border-[#10B981]/30 text-white/70 hover:text-[#34D399] rounded-lg text-sm font-light transition-all"
              >
                {exporting
                  ? <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                  : <Database className="w-4 h-4" strokeWidth={1.5} />
                }
                Export CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body space-y-6">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl text-[#F87171] text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" strokeWidth={1.5} />
            {error}
          </div>
        )}

        {/* KPI row */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-white/[0.03] border border-white/[0.06] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Activity} label="Requêtes totales" value={stats.totalRequests?.toLocaleString() ?? '0'} color="#9D4EDD" />
            <StatCard icon={Database} label="Bande passante" value={stats.bandwidthFormatted ?? formatBytes(stats.bandwidth ?? 0)} color="#22D3EE" />
            <StatCard icon={Zap} label="Temps moyen" value={`${stats.avgResponseTime ?? 0} ms`} color="#FBBF24" />
            <StatCard icon={TrendingUp} label="Taux d'erreur" value={`${stats.errorRate ?? 0}%`} sub={`Uptime ${stats.uptime ?? 100}%`} color={parseFloat(stats.errorRate) > 5 ? '#EF4444' : '#10B981'} />
          </div>
        )}

        {/* Traffic chart */}
        <Panel title="Trafic dans le temps" icon={BarChart3} color="#9D4EDD">
          {loading
            ? <div className="h-24 bg-white/[0.02] rounded animate-pulse" />
            : traffic.length === 0
              ? <p className="text-xs text-white/40 text-center py-8">Aucune donnée pour cette période</p>
              : (
                <>
                  <MiniBarChart data={traffic} valueKey="requests" />
                  <div className="flex items-end justify-between mt-2 text-[10px] text-white/30 overflow-hidden">
                    {traffic.filter((_, i) => i % Math.ceil(traffic.length / 6) === 0).map((d, i) => (
                      <span key={i}>{d.time}</span>
                    ))}
                  </div>
                </>
              )
          }
        </Panel>

        {/* Status codes + Top domains */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Status codes */}
          <Panel title="Distribution des codes HTTP" icon={Shield} color="#22D3EE">
            {loading
              ? <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)}</div>
              : totalStatus === 0
                ? <p className="text-xs text-white/40 text-center py-4">Aucune donnée</p>
                : (
                  <div className="space-y-4">
                    {Object.entries(statusCodes.groups).map(([group, count]) => {
                      const cfg = STATUS_COLOR[group] || STATUS_COLOR['2xx'];
                      return (
                        <div key={group} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className={`font-medium ${cfg.text}`}>{group}</span>
                            <span className="text-white/50">{count.toLocaleString()} ({pct(count, totalStatus)}%)</span>
                          </div>
                          <div className="w-full h-2 bg-white/[0.05] rounded-full overflow-hidden">
                            <div className={`h-full ${cfg.bar} rounded-full transition-all duration-500`} style={{ width: `${pct(count, totalStatus)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
            }
          </Panel>

          {/* Top domains */}
          <Panel title="Domaines les plus actifs" icon={Globe} color="#C77DFF">
            {loading
              ? <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)}</div>
              : topDomains.length === 0
                ? <p className="text-xs text-white/40 text-center py-4">Aucun domaine actif</p>
                : (
                  <div className="space-y-3">
                    {topDomains.map((d, i) => (
                      <HBar key={i} label={d.domain} value={d.requests} max={maxReq}
                        sub={d.bandwidth} color="bg-[#9D4EDD]" />
                    ))}
                  </div>
                )
            }
          </Panel>
        </div>

        {/* Top paths + Top IPs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Top paths */}
          <Panel title="Chemins les plus sollicités" icon={TrendingUp} color="#34D399">
            {loading
              ? <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)}</div>
              : topPaths.length === 0
                ? <p className="text-xs text-white/40 text-center py-4">Aucune donnée</p>
                : (
                  <div className="space-y-3">
                    {topPaths.map((p, i) => (
                      <div key={i} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <span className="text-[#22D3EE] font-mono flex-shrink-0">{p.method}</span>
                            <span className="text-white/80 font-mono truncate">{p.path}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 text-white/50">
                            <span>{p.requests.toLocaleString()}</span>
                            {p.avgTime > 0 && <span className="text-[#FBBF24]">{p.avgTime}ms</span>}
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div className="h-full bg-[#10B981] rounded-full transition-all duration-500" style={{ width: `${(p.requests / maxPathReq) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )
            }
          </Panel>

          {/* Top IPs */}
          <Panel title="IPs les plus actives" icon={Monitor} color="#F87171">
            {loading
              ? <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)}</div>
              : topIps.length === 0
                ? <p className="text-xs text-white/40 text-center py-4">Aucune donnée</p>
                : (
                  <div className="space-y-3">
                    {topIps.map((ip, i) => (
                      <div key={i} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="text-white/80 font-mono truncate">{ip.ip}</span>
                          <div className="flex items-center gap-2 flex-shrink-0 text-white/50">
                            <span>{ip.requests.toLocaleString()}</span>
                            {ip.errors > 0 && <span className="text-[#F87171]">{ip.errors} err</span>}
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div className="h-full bg-[#EF4444]/60 rounded-full transition-all duration-500" style={{ width: `${(ip.requests / maxIpReq) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )
            }
          </Panel>
        </div>

        {/* User Agents */}
        <Panel title="User Agents" icon={Clock} color="#FBBF24">
          {loading
            ? <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)}</div>
            : topAgents.length === 0
              ? <p className="text-xs text-white/40 text-center py-4">Aucune donnée</p>
              : (
                <div className="space-y-2">
                  {topAgents.map((a, i) => (
                    <HBar key={i} label={a.agent} value={a.requests} max={maxAgent} color="bg-[#FBBF24]/60" />
                  ))}
                </div>
              )
          }
        </Panel>
      </div>
    </div>
  );
}
