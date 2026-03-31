import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Globe, Server, Activity, Clock, AlertCircle,
  CheckCircle, Filter, Search, RefreshCw, Download, TrendingUp,
  Zap, Database, Users, BarChart3, Settings, FileText, Shield, Power, Trash2,
  Radio, Wifi
} from 'lucide-react';
import { domainAPI } from '../api/client';
import { FlagImg } from '../utils/flagCache';
import LoadBalancingPanel from '../components/features/LoadBalancingPanel';
import DomainAdvancedPanel from '../components/features/DomainAdvancedPanel';
import { Combobox } from '../components/ui/combobox';
import { Switch } from '@/components/ui/switch';

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
};
const timeAgo = (ts) => {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'à l\'instant';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
};
const PROTO_STYLE = {
  http:      'bg-blue-500/10   text-blue-400   border border-blue-500/20',
  tcp:       'bg-orange-500/10 text-orange-400  border border-orange-500/20',
  udp:       'bg-purple-500/10 text-purple-400  border border-purple-500/20',
  minecraft: 'bg-green-500/10  text-green-400   border border-green-500/20',
};

function TrafficTab({ connections, loading, autoRefresh, onToggleAuto, onRefresh, onClear }) {
  const [filterIp, setFilterIp] = useState('');
  const filtered = connections.filter(c => !filterIp || c.ip?.includes(filterIp));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            placeholder="Filtrer par IP..."
            value={filterIp}
            onChange={e => setFilterIp(e.target.value)}
            className="h-8 text-xs px-3 bg-white/[0.04] border border-white/[0.12] rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-[#9D4EDD]/50 w-40"
          />
          <span className="text-xs text-white/40">{filtered.length} entrée(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleAuto}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              autoRefresh
                ? 'bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white'
                : 'bg-white/[0.04] border border-white/[0.12] text-white/60'
            }`}
          >
            <Radio className="w-3.5 h-3.5" strokeWidth={1.5} />
            {autoRefresh ? 'Live' : 'Pausé'}
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.12] text-white/60 hover:text-white transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            Rafraîchir
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#F87171] hover:bg-[#EF4444]/20 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Effacer
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-white/30 text-sm">
            <Wifi className="w-10 h-10 mx-auto mb-3 opacity-20" strokeWidth={1} />
            {connections.length === 0
              ? 'Aucun trafic enregistré — les connexions apparaîtront ici (fenêtre 5 min)'
              : 'Aucun résultat pour ce filtre'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['IP', 'Pays', 'Protocole', 'Backend', 'Requêtes', 'Data', 'Dernier hit'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-white/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={`${c.ip}-${c.protocol}-${i}`} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-mono text-sm text-white">{c.ip}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {c.country
                          ? <FlagImg code={c.country} title={c.country} className="w-5 h-3.5 rounded-sm" />
                          : <Globe className="w-4 h-4 text-white/20" strokeWidth={1.5} />
                        }
                        <span className="text-xs text-white/40 font-mono">{c.country || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${PROTO_STYLE[c.protocol] || 'bg-white/5 text-white/40'}`}>
                        {c.protocol}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-white/40 font-mono max-w-[160px] truncate">{c.backend || '—'}</td>
                    <td className="px-4 py-2.5 text-sm font-semibold text-white">{c.reqCount}</td>
                    <td className="px-4 py-2.5 text-xs text-white/50">{fmtBytes(c.bytes)}</td>
                    <td className="px-4 py-2.5 text-xs text-white/40">{timeAgo(c.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2.5 border-t border-white/[0.04] bg-white/[0.01]">
          <p className="text-xs text-white/25">
            Fenêtre glissante 5 min — les entrées inactives disparaissent automatiquement.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DomainDetail() {
  const methodOptions = [
    { value: '', label: 'All Methods' },
    { value: 'GET', label: 'GET' },
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'PATCH', label: 'PATCH' },
  ];

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: '200', label: '200 OK' },
    { value: '201', label: '201 Created' },
    { value: '301', label: '301 Redirect' },
    { value: '400', label: '400 Bad Request' },
    { value: '401', label: '401 Unauthorized' },
    { value: '404', label: '404 Not Found' },
    { value: '500', label: '500 Server Error' },
    { value: '502', label: '502 Bad Gateway' },
  ];

  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [domain, setDomain] = useState(null);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    backendUrl: '',
    backendPort: '',
    description: '',
    sslEnabled: false,
    isActive: true
  });

  // Live traffic state
  const [trafficData, setTrafficData]         = useState([]);
  const [trafficLoading, setTrafficLoading]   = useState(false);
  const [trafficAuto, setTrafficAuto]         = useState(true);

  // Tab management
  const getTabFromPath = () => {
    const path = location.pathname;
    if (path.endsWith('/logs')) return 'logs';
    if (path.endsWith('/load-balancing')) return 'load-balancing';
    if (path.endsWith('/advanced')) return 'advanced';
    if (path.endsWith('/traffic')) return 'traffic';
    return 'overview';
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath());

  // Filters
  const [filters, setFilters] = useState({
    method: '',
    statusCode: '',
    search: '',
  });

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadDomainData();
    loadLogs();
    loadStats();
  }, [id]);

  useEffect(() => {
    if (autoRefresh && activeTab === 'logs') {
      const interval = setInterval(() => {
        loadLogs();
        loadStats();
      }, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, filters, activeTab]);

  // Load traffic when switching to traffic tab
  useEffect(() => {
    if (activeTab === 'traffic') loadTraffic();
  }, [activeTab]);

  // Auto-refresh traffic
  useEffect(() => {
    if (trafficAuto && activeTab === 'traffic') {
      const interval = setInterval(loadTraffic, 4000);
      return () => clearInterval(interval);
    }
  }, [trafficAuto, activeTab]);

  useEffect(() => {
    setActiveTab(getTabFromPath());
  }, [location.pathname]);

  const navigateToTab = (tab) => {
    const pathMap = {
      'overview':       `/domains/${id}`,
      'logs':           `/domains/${id}/logs`,
      'load-balancing': `/domains/${id}/load-balancing`,
      'advanced':       `/domains/${id}/advanced`,
      'traffic':        `/domains/${id}/traffic`,
    };
    navigate(pathMap[tab] || `/domains/${id}`, { replace: true });
  };

  const loadTraffic = async () => {
    if (!id) return;
    setTrafficLoading(true);
    try {
      const res = await domainAPI.getLiveTraffic(id);
      setTrafficData(res.data.connections || []);
    } catch (_) {
    } finally {
      setTrafficLoading(false);
    }
  };

  const clearTraffic = async () => {
    if (!confirm('Effacer les données de trafic pour ce domaine ?')) return;
    try {
      await domainAPI.clearLiveTraffic(id);
      setTrafficData([]);
    } catch (_) {}
  };

  const loadDomainData = async () => {
    try {
      const response = await domainAPI.get(id);
      const domainData = response.data.domain;
      setDomain(domainData);

      // Parse backend URL and port
      let backendUrl = domainData.backend_url || '';
      let backendPort = domainData.backend_port || '';
      if (backendUrl.includes('://')) {
        try {
          const parsedUrl = new URL(backendUrl);
          if (parsedUrl.port && !backendPort) {
            backendPort = parsedUrl.port;
          }
          if (domainData.proxy_type === 'tcp' || domainData.proxy_type === 'udp' || domainData.proxy_type === 'minecraft') {
            backendUrl = parsedUrl.hostname;
          } else {
            backendUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
          }
        } catch {
          // Keep raw value if parsing fails
        }
      }

      // Initialize form data
      setFormData({
        backendUrl: backendUrl,
        backendPort: backendPort,
        description: domainData.description || '',
        sslEnabled: domainData.ssl_enabled || false,
        isActive: domainData.is_active !== undefined ? domainData.is_active : true
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load domain');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const response = await domainAPI.getLogs(id, filters);
      setLogs(response.data.logs);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await domainAPI.getLogStats(id, { days: 1 });
      setStats(response.data.stats);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${domain?.hostname}?`)) return;
    try {
      await domainAPI.delete(id);
      navigate('/domains');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete domain');
    }
  };

  const getStatusColor = (status) => {
    if (status >= 200 && status < 300) return 'text-[#34D399]';
    if (status >= 300 && status < 400) return 'text-[#22D3EE]';
    if (status >= 400 && status < 500) return 'text-[#FBBF24]';
    if (status >= 500) return 'text-[#F87171]';
    return 'text-white/50';
  };

  const getStatusBgColor = (status) => {
    if (status >= 200 && status < 300) return 'bg-[#10B981]/10 border-[#10B981]/20';
    if (status >= 300 && status < 400) return 'bg-[#06B6D4]/10 border-[#06B6D4]/20';
    if (status >= 400 && status < 500) return 'bg-[#F59E0B]/10 border-[#F59E0B]/20';
    if (status >= 500) return 'bg-[#EF4444]/10 border-[#EF4444]/20';
    return 'bg-white/[0.02] border-white/[0.08]';
  };

  const getMethodColor = (method) => {
    const colors = {
      'GET': 'text-[#34D399]',
      'POST': 'text-[#22D3EE]',
      'PUT': 'text-[#FBBF24]',
      'DELETE': 'text-[#F87171]',
      'PATCH': 'text-[#C77DFF]'
    };
    return colors[method] || 'text-white/70';
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

    return date.toLocaleString();
  };

  const handleSaveDomain = async () => {
    setSaving(true);
    setError('');

    try {
      // Build the full backend URL with port if needed
      let fullBackendUrl = formData.backendUrl;
      if (domain.proxy_type === 'http') {
        // For HTTP, ensure we have the protocol
        if (!fullBackendUrl.includes('://')) {
          fullBackendUrl = 'http://' + fullBackendUrl;
        }
      } else if (domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft') {
        const protocol = domain.proxy_type === 'minecraft' ? 'tcp' : domain.proxy_type;
        if (!fullBackendUrl.includes('://')) {
          fullBackendUrl = `${protocol}://${fullBackendUrl}`;
        }
      }

      await domainAPI.update(id, {
        backendUrl: fullBackendUrl,
        backendPort: formData.backendPort ? String(formData.backendPort) : undefined,
        description: formData.description,
        sslEnabled: Boolean(formData.sslEnabled)
      });

      if (domain && formData.isActive !== domain.is_active) {
        await domainAPI.toggle(id);
      }

      // Reload domain data to reflect changes
      await loadDomainData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save domain');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
          <p className="text-white/70 font-light">Loading domain details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-[#EF4444]/10 backdrop-blur-lg border border-[#EF4444]/20 rounded-xl p-6 max-w-md">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-[#F87171]" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-[#F87171] mb-1">Error</p>
              <p className="text-sm text-white/70 font-light">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()}>
      <div className="page-header">
        <div className="page-header-inner">
          {/* Header */}
          <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={() => navigate(-1)}
                className="w-10 h-10 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 flex items-center justify-center transition-all duration-500"
              >
                <ArrowLeft className="w-5 h-5 text-white/70" strokeWidth={1.5} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight break-all">{domain?.hostname}</h1>
                  {domain?.is_active ? (
                    <span className="px-3 py-1 bg-[#10B981]/15 text-[#34D399] rounded-full text-xs font-medium tracking-wide border border-[#10B981]/30">
                      Active
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-white/[0.05] text-white/50 rounded-full text-xs font-medium tracking-wide border border-white/[0.08]">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/50 font-light mt-1 truncate">{domain?.backend_url}</p>
              </div>
              <button
                onClick={handleDelete}
                className="w-10 h-10 rounded-lg bg-[#EF4444]/10 hover:bg-[#EF4444]/20 border border-[#EF4444]/20 hover:border-[#EF4444]/40 flex items-center justify-center transition-all duration-500"
                title="Delete domain"
              >
                <Trash2 className="w-4 h-4 text-[#F87171]" strokeWidth={1.5} />
              </button>
              {activeTab === 'logs' && (
                <button
                  onClick={() => {
                    setAutoRefresh(!autoRefresh);
                  }}
                  className={`px-4 py-2.5 rounded-lg font-light text-sm flex items-center gap-2 transition-all duration-500 ${
                    autoRefresh
                      ? 'bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white'
                      : 'bg-white/[0.02] border border-white/[0.08] text-white/70 hover:border-[#9D4EDD]/30'
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                  {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mt-6 border-b border-white/[0.08]">
              {[
                { id: 'overview',       label: 'Overview',      icon: Settings },
                { id: 'logs',           label: 'Logs',          icon: FileText },
                { id: 'load-balancing', label: 'Load Balancing', icon: Server },
                { id: 'advanced',       label: 'Avancé',        icon: Zap },
                { id: 'traffic',        label: 'Trafic live',   icon: Radio },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => navigateToTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 text-xs font-light transition-all border-b-2 ${
                      activeTab === tab.id
                        ? 'border-[#9D4EDD] text-white'
                        : 'border-transparent text-white/60 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.5} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
        </div>
      </div>

      <div className="page-body">
        <div className="space-y-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Stats Cards */}
              {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Requests */}
            <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#9D4EDD]/20 hover: transition-all duration-500">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center group-hover: transition-all duration-500">
                  <Activity className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Total Requests</p>
                  <p className="text-xl font-light text-white tracking-tight">{stats.total_requests || 0}</p>
                </div>
              </div>
            </div>

            {/* Success Rate */}
            <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#10B981]/20 hover: transition-all duration-500">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/5 border border-[#10B981]/20 flex items-center justify-center transition-all duration-500">
                  <CheckCircle className="w-6 h-6 text-[#34D399]" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Success Rate</p>
                  <p className="text-xl font-light text-white tracking-tight">
                    {stats.total_requests > 0
                      ? Math.round((stats.success_count / stats.total_requests) * 100)
                      : 0}%
                  </p>
                </div>
              </div>
            </div>

            {/* Avg Response Time */}
            <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#22D3EE]/20 hover: transition-all duration-500">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#06B6D4]/10 to-[#06B6D4]/5 border border-[#06B6D4]/20 flex items-center justify-center transition-all duration-500">
                  <Zap className="w-6 h-6 text-[#22D3EE]" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Avg Response</p>
                  <p className="text-xl font-light text-white tracking-tight">
                    {stats.avg_response_time ? Math.round(stats.avg_response_time) : 0}ms
                  </p>
                </div>
              </div>
            </div>

            {/* Total Bandwidth */}
            <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#C77DFF]/20 hover: transition-all duration-500">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center transition-all duration-500">
                  <Database className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Total Bandwidth</p>
                  <p className="text-xl font-light text-white tracking-tight">
                    {formatBytes(stats.total_bandwidth)}
                  </p>
                </div>
              </div>
            </div>
                </div>
              )}

              {/* Domain Information & Settings - Inline Edit */}
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="text-base font-medium text-white tracking-tight">Domain Settings</h2>
                    <p className="text-xs text-white/60 font-light">Configure your domain and backend</p>
                  </div>
                </div>

                {error && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-[#F87171] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                    <p className="text-xs text-[#F87171]">{error}</p>
                  </div>
                )}

                <div className="space-y-5">
                  {/* Basic Information Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
                      <div className="w-1 h-4 bg-[#9D4EDD] rounded-full"></div>
                      Basic Information
                    </h3>

                    {/* Hostname (read-only) */}
                    <div>
                      <label className="text-xs font-medium text-white/70 mb-2 block">Hostname</label>
                      <div className="bg-white/[0.04] border border-white/[0.12] rounded-lg px-4 py-2.5">
                        <p className="text-sm text-white/80 font-mono">{domain?.hostname}</p>
                      </div>
                    </div>

                    {/* Proxy Type (read-only) */}
                    <div>
                      <label className="text-xs font-medium text-white/70 mb-2 block">Proxy Type</label>
                      <div className="bg-white/[0.04] border border-white/[0.12] rounded-lg px-4 py-2.5">
                        <p className="text-sm text-white/80 font-medium uppercase">
                          {domain?.proxy_type === 'tcp' ? 'TCP' : domain?.proxy_type === 'udp' ? 'UDP' : domain?.proxy_type === 'minecraft' ? 'MINECRAFT' : 'HTTP'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Backend Configuration Section */}
                  <div className="space-y-4 pt-2">
                    <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
                      <div className="w-1 h-4 bg-[#22D3EE] rounded-full"></div>
                      Backend Configuration
                    </h3>

                    {/* Backend URL */}
                    <div>
                      <label className="text-xs font-medium text-white/70 mb-2 block">
                        {domain?.proxy_type === 'http' ? 'Backend URL' : 'Backend IP/Hostname'}
                      </label>
                      <input
                        type="text"
                        value={formData.backendUrl}
                        onChange={(e) => setFormData({ ...formData, backendUrl: e.target.value })}
                        placeholder={domain?.proxy_type === 'http' ? 'http://192.168.1.100' : '192.168.1.100'}
                        className="w-full bg-white/[0.05] border border-white/[0.12] hover:border-white/[0.2] rounded-lg px-4 py-2.5 text-white text-sm font-light focus:outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all placeholder:text-white/30"
                      />
                    </div>

                    {/* Backend Port */}
                    <div>
                      <label className="text-xs font-medium text-white/70 mb-2 block">Backend Port</label>
                      <input
                        type="text"
                        value={formData.backendPort}
                        onChange={(e) => setFormData({ ...formData, backendPort: e.target.value })}
                        placeholder={domain?.proxy_type === 'minecraft' ? '25565' : '8080'}
                        className="w-full bg-white/[0.05] border border-white/[0.12] hover:border-white/[0.2] rounded-lg px-4 py-2.5 text-white text-sm font-light focus:outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all placeholder:text-white/30"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-xs font-medium text-white/70 mb-2 block">Description <span className="text-white/40">(Optional)</span></label>
                      <input
                        type="text"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Add a description for this domain"
                        className="w-full bg-white/[0.05] border border-white/[0.12] hover:border-white/[0.2] rounded-lg px-4 py-2.5 text-white text-sm font-light focus:outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all placeholder:text-white/30"
                      />
                    </div>
                  </div>

                  {/* Settings Section */}
                  <div className="space-y-3 pt-2">
                    <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
                      <div className="w-1 h-4 bg-[#FBBF24] rounded-full"></div>
                      Settings
                    </h3>

                    {/* SSL Enabled Toggle (HTTP only) */}
                    {domain?.proxy_type === 'http' && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.04] border border-white/[0.12] hover:border-white/[0.18] transition-all">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg bg-[#9D4EDD]/10 border border-[#9D4EDD]/20 flex items-center justify-center">
                            <Shield className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-white cursor-pointer block">
                              SSL/TLS
                            </label>
                            <p className="text-xs text-white/50 mt-0.5">
                              Secure with Let's Encrypt certificate
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={formData.sslEnabled}
                          onCheckedChange={(checked) => setFormData({ ...formData, sslEnabled: checked })}
                        />
                      </div>
                    )}

                    {/* Status Toggle */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.04] border border-white/[0.12] hover:border-white/[0.18] transition-all">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 border border-[#10B981]/20 flex items-center justify-center">
                          <Power className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-white cursor-pointer block">
                            Domain Status
                          </label>
                          <p className="text-xs text-white/50 mt-0.5">
                            {formData.isActive ? 'Domain is active and proxying traffic' : 'Domain is currently disabled'}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={formData.isActive}
                        onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                      />
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="pt-1">
                    <button
                      onClick={handleSaveDomain}
                      disabled={saving}
                      className="w-full bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] hover:from-[#7B2CBF] hover:to-[#5B1F9C] text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#9D4EDD]/20"
                    >
                      {saving ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                          Saving Changes...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4" strokeWidth={1.5} />
                          Save Changes
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <>
              {/* Stats Cards */}
              {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Total Requests */}
                  <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#9D4EDD]/20 hover: transition-all duration-500">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center group-hover: transition-all duration-500">
                        <Activity className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Total Requests</p>
                        <p className="text-xl font-light text-white tracking-tight">{stats.total_requests || 0}</p>
                      </div>
                    </div>
                  </div>

                  {/* Success Rate */}
                  <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#10B981]/20 hover: transition-all duration-500">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/5 border border-[#10B981]/20 flex items-center justify-center transition-all duration-500">
                        <CheckCircle className="w-6 h-6 text-[#34D399]" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Success Rate</p>
                        <p className="text-xl font-light text-white tracking-tight">
                          {stats.total_requests > 0
                            ? Math.round((stats.success_count / stats.total_requests) * 100)
                            : 0}%
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Avg Response Time */}
                  <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#22D3EE]/20 hover: transition-all duration-500">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#06B6D4]/10 to-[#06B6D4]/5 border border-[#06B6D4]/20 flex items-center justify-center transition-all duration-500">
                        <Zap className="w-6 h-6 text-[#22D3EE]" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Avg Response</p>
                        <p className="text-xl font-light text-white tracking-tight">
                          {stats.avg_response_time ? Math.round(stats.avg_response_time) : 0}ms
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Total Bandwidth */}
                  <div className="group bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-[#1A1B28]/60 hover:border-[#C77DFF]/20 hover: transition-all duration-500">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center transition-all duration-500">
                        <Database className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">Total Bandwidth</p>
                        <p className="text-xl font-light text-white tracking-tight">
                          {formatBytes(stats.total_bandwidth)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Logs Console */}
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl  overflow-hidden">

          {/* Console Header */}
          <div className="p-4 border-b border-white/[0.08]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-lg font-light text-white tracking-tight">Request Logs</h2>
                  <p className="text-xs text-white/50 font-light">Real-time HTTP request monitoring</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadLogs}
                  disabled={logsLoading}
                  className="px-4 py-2 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/70 hover:text-[#C77DFF] rounded-lg text-sm font-light transition-all duration-500 flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${logsLoading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">Method</label>
                <Combobox
                  value={filters.method}
                  onValueChange={(value) => setFilters({ ...filters, method: value })}
                  options={methodOptions}
                  placeholder="All Methods"
                  searchPlaceholder="Search method..."
                  emptyText="No method found."
                  triggerClassName="h-10 text-sm bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">Status Code</label>
                <Combobox
                  value={filters.statusCode}
                  onValueChange={(value) => setFilters({ ...filters, statusCode: value })}
                  options={statusOptions}
                  placeholder="All Status"
                  searchPlaceholder="Search status..."
                  emptyText="No status found."
                  triggerClassName="h-10 text-sm bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">Search Path</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="Search in request path..."
                    className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-white/90 placeholder-white/30 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Logs Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Time</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Method</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Path</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Response Time</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Size</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase tracking-[0.15em]">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.08]">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-8 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/[0.02] border border-white/[0.08] flex items-center justify-center">
                          <Activity className="w-5 h-5 text-white/30" strokeWidth={1.5} />
                        </div>
                        <p className="text-sm text-white/50 font-light">No requests logged yet</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors duration-200">
                      <td className="px-4 py-3 text-xs text-white/70 font-light whitespace-nowrap">
                        {formatDate(log.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${getMethodColor(log.method)}`}>
                          {log.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-white/90 font-light max-w-md truncate">
                        {log.path}
                        {log.query_string && (
                          <span className="text-white/50">?{log.query_string}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-md text-xs font-medium border ${getStatusBgColor(log.status_code)} ${getStatusColor(log.status_code)}`}>
                          {log.status_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-white/70 font-light whitespace-nowrap">
                        {log.response_time ? `${log.response_time}ms` : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-white/70 font-light whitespace-nowrap">
                        {formatBytes(log.response_size)}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/50 font-light whitespace-nowrap">
                        {log.ip_address || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

                {logs.length > 0 && (
                  <div className="px-4 py-3 border-t border-white/[0.08]">
                    <p className="text-xs text-white/50 font-light">
                      {logs.length} requête(s) affichée(s)
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Load Balancing Tab */}
          {activeTab === 'load-balancing' && (
            <LoadBalancingPanel domainId={id} onUpdate={loadDomainData} />
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && (
            <DomainAdvancedPanel domain={domain} onUpdate={loadDomainData} />
          )}

          {/* Traffic Tab */}
          {activeTab === 'traffic' && (
            <TrafficTab
              connections={trafficData}
              loading={trafficLoading}
              autoRefresh={trafficAuto}
              onToggleAuto={() => setTrafficAuto(v => !v)}
              onRefresh={loadTraffic}
              onClear={clearTraffic}
            />
          )}
        </div>
      </div>

    </div>
  );
}
