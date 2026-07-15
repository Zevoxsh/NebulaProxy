import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Search, RefreshCw, Download, Filter, ChevronDown,
  CheckCircle, XCircle, AlertTriangle, Clock, Globe, ArrowUp, ArrowDown,
  ScrollText, Wifi, WifiOff, Minus
} from 'lucide-react';
import { logsAPI, monitoringAPI } from '../api/client';
import { PaginationControls } from '@/components/ui/pagination-controls';
import { useToast } from '@/hooks/use-toast';

// ─── helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 5000)  return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(2)}MB`;
}

const TIME_RANGES = [
  { label: '15m', ms: 15 * 60 * 1000 },
  { label: '1h',  ms: 3600 * 1000 },
  { label: '6h',  ms: 6 * 3600 * 1000 },
  { label: '24h', ms: 86400 * 1000 },
  { label: '7d',  ms: 7 * 86400 * 1000 },
];

const METHOD_COLORS = {
  GET:    'bg-[#06B6D4]/15 text-[#22D3EE] border-[#06B6D4]/30',
  POST:   'bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30',
  PUT:    'bg-[#F59E0B]/15 text-[#FBBF24] border-[#F59E0B]/30',
  DELETE: 'bg-[#EF4444]/15 text-[#F87171] border-[#EF4444]/30',
  PATCH:  'bg-[#9D4EDD]/15 text-[#C77DFF] border-[#9D4EDD]/30',
};

function MethodBadge({ method }) {
  const cls = METHOD_COLORS[method] || 'bg-white/[0.06] text-white/60 border-white/[0.1]';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${cls}`}>
      {method || '—'}
    </span>
  );
}

function StatusBadge({ code }) {
  if (!code) return <span className="text-xs text-white/30">—</span>;
  let cls = 'bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30';
  if (code >= 500) cls = 'bg-[#EF4444]/15 text-[#F87171] border-[#EF4444]/30';
  else if (code >= 400) cls = 'bg-[#F59E0B]/15 text-[#FBBF24] border-[#F59E0B]/30';
  else if (code >= 300) cls = 'bg-[#06B6D4]/15 text-[#22D3EE] border-[#06B6D4]/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${cls}`}>
      {code}
    </span>
  );
}

function RespTimeBadge({ ms }) {
  if (ms == null) return <span className="text-xs text-white/30">—</span>;
  const color = ms > 1000 ? 'text-[#F87171]' : ms > 500 ? 'text-[#FBBF24]' : 'text-[#34D399]';
  return <span className={`text-xs font-mono ${color}`}>{fmtMs(ms)}</span>;
}

// ─── severity ────────────────────────────────────────────────────────────────

const SEVERITY = {
  grave:  { label: 'Grave',  dot: 'bg-[#F87171]',  cls: 'bg-[#EF4444]/15 text-[#F87171] border-[#EF4444]/30',  row: 'border-l-2 border-l-[#EF4444]/70' },
  haute:  { label: 'Haute',  dot: 'bg-[#FBBF24]',  cls: 'bg-[#F59E0B]/15 text-[#FBBF24] border-[#F59E0B]/30',  row: 'border-l-2 border-l-[#F59E0B]/60' },
  faible: { label: 'Faible', dot: 'bg-[#34D399]',  cls: 'bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30',  row: '' },
};

function getSeverity(log) {
  const s  = log.status_code  || 0;
  const rt = log.response_time || 0;
  const hasErr = !!log.error_message;

  // Grave: 5xx server errors, timeout (>5s), or any error with 4xx+error_message on high RT
  if (s >= 500 || rt > 5000 || (hasErr && s >= 500)) return 'grave';
  // Haute: 4xx client errors, slow responses (>1s), or presence of error message
  if (s >= 400 || rt > 1000 || hasErr) return 'haute';
  // Faible: 2xx/3xx fast with no error
  return 'faible';
}

function SeverityBadge({ severity }) {
  const cfg = SEVERITY[severity] || SEVERITY.faible;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot} ${severity === 'grave' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

function HealthEventBadge({ status, prevStatus, isTransition }) {
  if (isTransition) {
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#EF4444]/15 text-[#F87171] border border-[#EF4444]/30">
          <ArrowDown className="w-3 h-3" strokeWidth={2} /> DOWN
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
        <ArrowUp className="w-3 h-3" strokeWidth={2} /> UP
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30">
        <XCircle className="w-3 h-3" strokeWidth={1.5} /> FAILED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
      <CheckCircle className="w-3 h-3" strokeWidth={1.5} /> OK
    </span>
  );
}

// ─── stat card ───────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color, delay }) {
  return (
    <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 animate-fade-in" style={{ animationDelay: delay }}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="w-5 h-5" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em]">{label}</p>
          <p className="text-xl font-light text-white">{value}</p>
          {sub && <p className="text-[10px] text-white/30 font-light">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function ActivityLog() {
  const { toast } = useToast();

  // Tab
  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'health'

  // Shared filters
  const [domainFilter, setDomainFilter] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [autoRefresh, setAutoRefresh] = useState('off');

  // Request filters
  const [statusRange, setStatusRange] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');

  // Health filters
  const [healthStatus, setHealthStatus] = useState('');
  const [transitionsOnly, setTransitionsOnly] = useState(false);

  // Severity filter (client-side, requests tab only)
  const [severityFilter, setSeverityFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 100;

  // Data
  const [logs, setLogs] = useState([]);
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [domains, setDomains] = useState([]);
  const [domainsDown, setDomainsDown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);

  // Derived stats + visible rows
  const { stats, visibleLogs, severityCounts } = (() => {
    if (activeTab !== 'requests' || !logs.length) {
      return { stats: { total, errorRate: 0, avgRt: 0 }, visibleLogs: logs, severityCounts: { grave: 0, haute: 0, faible: 0 } };
    }
    const counts = { grave: 0, haute: 0, faible: 0 };
    for (const l of logs) counts[getSeverity(l)]++;

    const visible = severityFilter ? logs.filter(l => getSeverity(l) === severityFilter) : logs;
    const errors  = logs.filter(l => l.status_code >= 400).length;
    const rtLogs  = logs.filter(l => l.response_time != null);
    const avgRt   = rtLogs.length ? Math.round(rtLogs.reduce((s, l) => s + l.response_time, 0) / rtLogs.length) : 0;
    return {
      stats: { total, errorRate: logs.length ? ((errors / logs.length) * 100).toFixed(1) : 0, avgRt },
      visibleLogs: visible,
      severityCounts: counts,
    };
  })();

  // Debounce search
  const searchDebounce = useRef(null);
  const handleSearchChange = (v) => {
    setSearchRaw(v);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => { setSearch(v); setPage(1); }, 300);
  };

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [domainFilter, timeRange, statusRange, methodFilter, healthStatus, transitionsOnly, activeTab, severityFilter]);

  // Compute startDate from timeRange
  const getStartDate = useCallback(() => {
    const ms = TIME_RANGES.find(r => r.label === timeRange)?.ms || 86400000;
    return new Date(Date.now() - ms).toISOString();
  }, [timeRange]);

  // Fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = getStartDate();
      const offset = (page - 1) * ITEMS_PER_PAGE;

      if (activeTab === 'requests') {
        const params = { limit: ITEMS_PER_PAGE, offset, startDate };
        if (domainFilter) params.domainId = domainFilter;
        if (methodFilter) params.method = methodFilter;
        if (statusRange)  params.statusRange = statusRange;
        if (search)       params.search = search;

        const res = await logsAPI.getActivity(params);
        setLogs(res.data.logs || []);
        setTotal(res.data.total || 0);
        if (res.data.domains?.length) setDomains(res.data.domains);
      } else {
        const params = { limit: ITEMS_PER_PAGE, offset, startDate, transitionsOnly: String(transitionsOnly) };
        if (domainFilter) params.domainId = domainFilter;
        if (healthStatus) params.status = healthStatus;

        const res = await logsAPI.getHealthEvents(params);
        setEvents(res.data.events || []);
        setTotal(res.data.total || 0);
      }

      if (firstLoad) {
        setFirstLoad(false);
        // Get domains down count
        try {
          const mRes = await monitoringAPI.getStats();
          setDomainsDown(mRes.data.down || 0);
        } catch { /* non-critical */ }
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.error || 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  }, [activeTab, domainFilter, methodFilter, statusRange, search, healthStatus, transitionsOnly, page, getStartDate, firstLoad, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh
  const arRef = useRef(null);
  useEffect(() => {
    clearInterval(arRef.current);
    if (autoRefresh !== 'off') {
      const ms = parseInt(autoRefresh, 10) * 1000;
      arRef.current = setInterval(fetchData, ms);
    }
    return () => clearInterval(arRef.current);
  }, [autoRefresh, fetchData]);

  // Export CSV
  const handleExport = async () => {
    try {
      const params = { startDate: getStartDate() };
      if (domainFilter) params.domainId = domainFilter;
      if (methodFilter) params.method = methodFilter;
      if (statusRange)  params.statusRange = statusRange;
      if (search)       params.search = search;
      const res = await logsAPI.exportCsv(params);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `activity-${new Date().toISOString()}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {
      toast({ variant: 'destructive', title: 'Export failed' });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between gap-3 flex-wrap animate-fade-in">
            <div>
              <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Activity Log</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">Toutes les requêtes et la disponibilité de vos domaines en un seul endroit</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Auto-refresh */}
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-1.5">
                <Wifi className={`w-3.5 h-3.5 ${autoRefresh !== 'off' ? 'text-[#34D399] animate-pulse' : 'text-white/30'}`} strokeWidth={1.5} />
                <select
                  value={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.value)}
                  className="bg-transparent text-xs text-white/70 focus:outline-none cursor-pointer"
                >
                  <option value="off">Off</option>
                  <option value="5">5s</option>
                  <option value="15">15s</option>
                  <option value="30">30s</option>
                </select>
              </div>
              <button onClick={fetchData} className="p-2 text-white/40 hover:text-white/70 hover:bg-white/[0.04] rounded-lg transition-all" title="Refresh">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              </button>
              {activeTab === 'requests' && (
                <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-xs px-3 py-2">
                  <Download className="w-3.5 h-3.5" strokeWidth={1.5} /> Export CSV
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <StatCard icon={Activity}      label="Total"       value={total.toLocaleString()}          sub={`in ${timeRange}`}  color="bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 text-[#C77DFF]" delay="0.1s" />
          <StatCard icon={AlertTriangle} label="Error Rate"  value={`${stats.errorRate}%`}           sub="4xx + 5xx"          color="bg-gradient-to-br from-[#EF4444]/10 to-[#EF4444]/5 border border-[#EF4444]/20 text-[#F87171]" delay="0.15s" />
          <StatCard icon={Clock}         label="Avg Resp."   value={fmtMs(stats.avgRt)}              sub="this page"          color="bg-gradient-to-br from-[#06B6D4]/10 to-[#06B6D4]/5 border border-[#06B6D4]/20 text-[#22D3EE]" delay="0.2s" />
          <StatCard icon={WifiOff}       label="Domains Down" value={domainsDown}                    sub="right now"          color="bg-gradient-to-br from-[#F59E0B]/10 to-[#F59E0B]/5 border border-[#F59E0B]/20 text-[#FBBF24]" delay="0.25s" />
          {activeTab === 'requests' && (
            <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2">Gravité</p>
              <div className="space-y-1">
                {[['grave','Grave','text-[#F87171]'],['haute','Haute','text-[#FBBF24]'],['faible','Faible','text-[#34D399]']].map(([k, l, c]) => (
                  <button key={k} onClick={() => setSeverityFilter(f => f === k ? '' : k)}
                    className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs transition-all ${severityFilter === k ? 'bg-white/[0.08] ring-1 ring-white/20' : 'hover:bg-white/[0.04]'}`}>
                    <span className={`font-medium ${c}`}>{l}</span>
                    <span className="font-mono text-white/60">{severityCounts[k] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Filters ── */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 mb-4 space-y-3 animate-fade-in" style={{ animationDelay: '0.3s' }}>
          {/* Row 1: domain + time range */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/40" strokeWidth={1.5} />
              <select
                value={domainFilter}
                onChange={e => setDomainFilter(e.target.value)}
                className="bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-white/80 px-3 py-1.5 focus:outline-none focus:border-[#9D4EDD]/40"
              >
                <option value="">All domains</option>
                {domains.map(d => <option key={d.id} value={d.id}>{d.hostname}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs text-white/40 mr-1">Range</span>
              {TIME_RANGES.map(r => (
                <button
                  key={r.label}
                  onClick={() => setTimeRange(r.label)}
                  className={timeRange === r.label ? 'btn-primary px-2.5 py-1 text-xs' : 'btn-secondary px-2.5 py-1 text-xs'}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: tab-specific filters */}
          {activeTab === 'requests' && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Status range */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 mr-1">Status</span>
                {[['', 'Tous'], ['2xx', '2xx'], ['3xx', '3xx'], ['4xx', '4xx'], ['5xx', '5xx'], ['errors', 'Erreurs']].map(([v, l]) => (
                  <button key={v} onClick={() => setStatusRange(v)}
                    className={statusRange === v ? 'btn-primary px-2.5 py-1 text-xs' : 'btn-secondary px-2.5 py-1 text-xs'}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Method */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 mr-1">Method</span>
                {[['', 'Tous'], ['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['DELETE', 'DEL'], ['PATCH', 'PATCH']].map(([v, l]) => (
                  <button key={v} onClick={() => setMethodFilter(v)}
                    className={methodFilter === v ? 'btn-primary px-2.5 py-1 text-xs' : 'btn-secondary px-2.5 py-1 text-xs'}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Severity */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 mr-1">Gravité</span>
                {[['', 'Toutes'], ['grave', 'Grave'], ['haute', 'Haute'], ['faible', 'Faible']].map(([v, l]) => (
                  <button key={v} onClick={() => setSeverityFilter(v)}
                    className={severityFilter === v ? 'btn-primary px-2.5 py-1 text-xs' : 'btn-secondary px-2.5 py-1 text-xs'}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" strokeWidth={1.5} />
                <input
                  type="text"
                  value={searchRaw}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Search path or IP…"
                  className="input-futuristic pl-8 text-xs py-1.5 w-52"
                />
              </div>
            </div>
          )}

          {activeTab === 'health' && (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 mr-1">État</span>
                {[['', 'Tous'], ['failed', 'Down'], ['success', 'Up']].map(([v, l]) => (
                  <button key={v} onClick={() => setHealthStatus(v)}
                    className={healthStatus === v ? 'btn-primary px-2.5 py-1 text-xs' : 'btn-secondary px-2.5 py-1 text-xs'}>
                    {l}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setTransitionsOnly(v => !v)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${transitionsOnly ? 'bg-[#9D4EDD]' : 'bg-white/[0.1]'}`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${transitionsOnly ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-xs text-white/60">Transitions only (Down/Up changes)</span>
              </label>
            </div>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-2 mb-4">
          {[['requests', 'Requêtes HTTP', Activity], ['health', 'Disponibilité', CheckCircle]].map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 text-xs ${activeTab === id ? 'btn-primary px-4 py-2' : 'btn-secondary px-4 py-2'}`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
              {label}
              {activeTab === id && total > 0 && (
                <span className="bg-black/20 text-current text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{total.toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Table ── */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden animate-fade-in" style={{ animationDelay: '0.35s' }}>

          {loading && (activeTab === 'requests' ? logs : events).length === 0 ? (
            /* Loading skeleton */
            <div className="divide-y divide-white/[0.05]">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                  <div className="h-3 w-24 bg-white/[0.06] rounded" />
                  <div className="h-3 w-28 bg-white/[0.05] rounded" />
                  <div className="h-3 w-12 bg-white/[0.05] rounded" />
                  <div className="h-3 w-40 bg-white/[0.04] rounded flex-1" />
                  <div className="h-3 w-10 bg-white/[0.04] rounded" />
                  <div className="h-3 w-14 bg-white/[0.04] rounded" />
                  <div className="h-3 w-24 bg-white/[0.03] rounded" />
                </div>
              ))}
            </div>
          ) : activeTab === 'requests' ? (
            logs.length === 0 ? (
              <div className="p-12 text-center">
                <ScrollText className="w-10 h-10 text-white/20 mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-sm font-light text-white/50">No requests match the current filters</p>
                <p className="text-xs text-white/30 mt-1">Try widening the time range or removing filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead className="border-b border-white/[0.08]">
                    <tr>
                      {['Gravité', 'Time', 'Domain', 'Method', 'Path', 'Status', 'Resp.', 'Size', 'IP', 'Country'].map(h => (
                        <th key={h} className="text-left text-[10px] uppercase tracking-[0.15em] text-white/40 font-medium px-3 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLogs.map(log => {
                      const sev = getSeverity(log);
                      return (
                        <tr key={log.id} className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors ${SEVERITY[sev].row}`}>
                          <td className="px-3 py-2"><SeverityBadge severity={sev} /></td>
                          <td className="px-3 py-2">
                            <span title={new Date(log.timestamp).toLocaleString()} className="text-xs text-white/50 font-mono whitespace-nowrap cursor-default">
                              {timeAgo(log.timestamp)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs text-white/70 font-light truncate max-w-[120px] block" title={log.hostname}>{log.hostname}</span>
                          </td>
                          <td className="px-3 py-2"><MethodBadge method={log.method} /></td>
                          <td className="px-3 py-2 max-w-[200px]">
                            <span className="text-xs text-white/80 font-mono truncate block" title={log.path}>{log.path}</span>
                            {log.error_message && (
                              <span className="text-[10px] text-[#F87171] truncate block" title={log.error_message}>{log.error_message}</span>
                            )}
                          </td>
                          <td className="px-3 py-2"><StatusBadge code={log.status_code} /></td>
                          <td className="px-3 py-2"><RespTimeBadge ms={log.response_time} /></td>
                          <td className="px-3 py-2"><span className="text-xs text-white/40 font-mono">{fmtBytes(log.response_size)}</span></td>
                          <td className="px-3 py-2"><span className="text-xs text-white/50 font-mono">{log.ip_address || '—'}</span></td>
                          <td className="px-3 py-2"><span className="text-xs text-white/40">{log.country || '—'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* Disponibilité tab */
            events.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle className="w-10 h-10 text-white/20 mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-sm font-light text-white/50">Aucun événement de disponibilité sur cette période</p>
                <p className="text-xs text-white/30 mt-1">Les health checks doivent être activés sur vos domaines</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="border-b border-white/[0.08]">
                    <tr>
                      {['Time', 'Domain', 'Event', 'Resp. Time', 'HTTP Status', 'Error', 'Previous'].map(h => (
                        <th key={h} className="text-left text-[10px] uppercase tracking-[0.15em] text-white/40 font-medium px-3 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(ev => {
                      const isDown = ev.isTransition && ev.status === 'failed';
                      const isUp   = ev.isTransition && ev.status === 'success';
                      const rowBorder = isDown ? 'border-l-2 border-l-[#EF4444]/60' : isUp ? 'border-l-2 border-l-[#34D399]/60' : '';
                      return (
                        <tr key={ev.id} className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors ${rowBorder}`}>
                          <td className="px-3 py-2">
                            <span title={new Date(ev.checked_at).toLocaleString()} className="text-xs text-white/50 font-mono whitespace-nowrap cursor-default">
                              {timeAgo(ev.checked_at)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs text-white/70 font-light">{ev.hostname}</span>
                          </td>
                          <td className="px-3 py-2">
                            <HealthEventBadge status={ev.status} prevStatus={ev.prev_status} isTransition={ev.isTransition} />
                          </td>
                          <td className="px-3 py-2"><RespTimeBadge ms={ev.response_time} /></td>
                          <td className="px-3 py-2"><StatusBadge code={ev.status_code} /></td>
                          <td className="px-3 py-2 max-w-[200px]">
                            {ev.error_message
                              ? <span className="text-[10px] text-[#F87171] truncate block" title={ev.error_message}>{ev.error_message}</span>
                              : <span className="text-xs text-white/20">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {ev.prev_status
                              ? <span className={`text-xs font-medium ${ev.prev_status === 'failed' ? 'text-[#F87171]' : 'text-[#34D399]'}`}>{ev.prev_status === 'failed' ? 'DOWN' : 'UP'}</span>
                              : <span className="text-xs text-white/20">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Pagination */}
          {total > ITEMS_PER_PAGE && (
            <div className="px-4 py-3 border-t border-white/[0.06]">
              <PaginationControls
                currentPage={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={ITEMS_PER_PAGE}
                onPageChange={setPage}
                label={activeTab === 'requests' ? 'requests' : 'events'}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
