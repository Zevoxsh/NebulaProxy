import { useState, useEffect, useCallback } from 'react';
import { Shield, Ban, RefreshCw, Trash2, Plus, Database, ShieldAlert } from 'lucide-react';
import { adminAPI } from '../../api/client';

export default function AdminDdos() {
  const [stats, setStats] = useState(null);
  const [bans, setBans] = useState([]);
  const [blocklists, setBlocklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterIp, setFilterIp] = useState('');
  const [showBanForm, setShowBanForm] = useState(false);
  const [banForm, setBanForm] = useState({ ip: '', reason: 'manual-ban', durationSec: 3600 });
  const [message, setMessage] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, bansRes, blocklistsRes] = await Promise.all([
        adminAPI.getDdosStats(),
        adminAPI.getDdosBans({ ip: filterIp || undefined, limit: 100 }),
        adminAPI.getDdosBlocklists()
      ]);
      setStats(statsRes.data);
      setBans(bansRes.data.bans || []);
      setBlocklists(blocklistsRes.data.blocklists || []);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load DDoS data' });
    } finally {
      setLoading(false);
    }
  }, [filterIp]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await adminAPI.syncDdosBlocklists();
      setMessage({ type: 'success', text: 'Blocklist sync started (runs in background ~30s)' });
      setTimeout(() => { fetchAll(); setMessage(null); }, 8000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to start sync' });
    } finally {
      setTimeout(() => setSyncing(false), 2000);
    }
  };

  const handleUnban = async (id) => {
    if (!confirm('Unban this IP?')) return;
    try {
      await adminAPI.deleteDdosBan(id);
      setBans(b => b.filter(ban => ban.id !== id));
      setMessage({ type: 'success', text: 'IP unbanned successfully' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to unban IP' });
    }
  };

  const handleBan = async () => {
    if (!banForm.ip) return;
    try {
      await adminAPI.createDdosBan(banForm);
      setMessage({ type: 'success', text: `IP ${banForm.ip} banned` });
      setShowBanForm(false);
      setBanForm({ ip: '', reason: 'manual-ban', durationSec: 3600 });
      setTimeout(() => { fetchAll(); setMessage(null); }, 500);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to ban IP' });
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleString() : '—';

  const sourceLabel = (source) => ({
    blocklist_de: 'blocklist.de',
    emerging_threats: 'Emerging Threats',
    ci_badguys: 'CI Badguys'
  }[source] || source);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#3B82F6]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#EF4444]" strokeWidth={1.5} />
            Protection Anti-DDoS
          </h1>
          <p className="text-sm text-white/50 mt-0.5">Gestion des bans IP et des listes de menaces</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-[#1F2937] hover:bg-[#374151] border border-white/[0.08] text-white text-sm rounded-lg transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          Sync Blocklists
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-lg text-sm border ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {message.text}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Bans actifs', value: stats.active_bans || 0, color: 'text-[#EF4444]', icon: Ban },
            { label: 'Bloqués aujourd\'hui', value: stats.blocked_today || 0, color: 'text-[#F59E0B]', icon: Shield },
            { label: 'Total bans', value: stats.total_bans || 0, color: 'text-white', icon: ShieldAlert },
            { label: 'IPs blocklists', value: (stats.blocklist_ips || 0).toLocaleString(), color: 'text-[#3B82F6]', icon: Database }
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="bg-[#161B22] border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color} opacity-70`} strokeWidth={1.5} />
                <p className="text-xs text-white/40">{label}</p>
              </div>
              <p className={`text-2xl font-semibold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Active Bans */}
      <div className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <Ban className="w-4 h-4 text-[#EF4444]" strokeWidth={1.5} />
            Bans IP actifs
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filtrer par IP..."
              value={filterIp}
              onChange={e => setFilterIp(e.target.value)}
              className="text-xs px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-white/20 w-40"
            />
            <button
              onClick={() => setShowBanForm(!showBanForm)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20 rounded-lg transition-all"
            >
              <Plus className="w-3 h-3" />
              Bannir IP
            </button>
          </div>
        </div>

        {/* Manual ban form */}
        {showBanForm && (
          <div className="p-4 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-white/40 mb-1 block">Adresse IP</label>
                <input
                  type="text"
                  placeholder="1.2.3.4"
                  value={banForm.ip}
                  onChange={e => setBanForm(f => ({ ...f, ip: e.target.value }))}
                  className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-white/20"
                />
              </div>
              <div className="w-36">
                <label className="text-xs text-white/40 mb-1 block">Durée (sec) — 0 = ∞</label>
                <input
                  type="number"
                  value={banForm.durationSec}
                  onChange={e => setBanForm(f => ({ ...f, durationSec: parseInt(e.target.value) || 3600 }))}
                  className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white focus:outline-none focus:border-white/20"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleBan}
                  className="px-4 py-2 bg-[#EF4444] hover:bg-[#DC2626] text-white text-sm rounded-lg transition-all"
                >
                  Bannir
                </button>
                <button
                  onClick={() => setShowBanForm(false)}
                  className="px-3 py-2 text-white/40 hover:text-white text-sm transition-all"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bans table */}
        <div className="overflow-x-auto">
          {bans.length === 0 ? (
            <div className="p-10 text-center text-white/30 text-sm">
              <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" strokeWidth={1} />
              Aucun ban actif
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Adresse IP', 'Domaine', 'Raison', 'Source', 'Expire le', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bans.map(ban => (
                  <tr key={ban.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 text-sm font-mono text-white">{ban.ip_address}</td>
                    <td className="px-4 py-2.5 text-sm text-white/60">
                      {ban.hostname || <span className="text-white/20 italic">Global</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-white/50 max-w-[160px] truncate">{ban.reason}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        ban.banned_by === 'admin'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-orange-500/10 text-orange-400'
                      }`}>
                        {ban.banned_by}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-white/40">
                      {ban.expires_at ? formatDate(ban.expires_at) : '∞ Permanent'}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleUnban(ban.id)}
                        className="p-1.5 text-white/30 hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded transition-all"
                        title="Unban"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Blocklists */}
      <div className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-white/[0.06]">
          <Database className="w-4 h-4 text-[#3B82F6]" strokeWidth={1.5} />
          <h2 className="text-sm font-medium text-white">Listes de menaces (Threat Intelligence)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Source', 'IPs chargées', 'Dernière sync', 'Statut'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blocklists.map(bl => (
                <tr key={bl.source} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-white">{sourceLabel(bl.source)}</div>
                    <div className="text-xs text-white/25 mt-0.5 truncate max-w-xs font-mono">{bl.url}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-white/70">
                    {bl.ip_count ? (bl.ip_count).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/40">
                    {formatDate(bl.last_fetched)}
                  </td>
                  <td className="px-4 py-3">
                    {bl.last_error ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400" title={bl.last_error}>
                        Erreur
                      </span>
                    ) : bl.last_fetched ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400">
                        OK
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-white/30">
                        En attente
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-white/[0.06] bg-white/[0.01]">
          <p className="text-xs text-white/25">Les listes sont synchronisées automatiquement toutes les 6 heures. Les IPs des listes sont bannies en permanence.</p>
        </div>
      </div>
    </div>
  );
}
