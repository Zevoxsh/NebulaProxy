import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Ban, RefreshCw, Trash2, Plus, Database, ShieldAlert,
  Activity, List, CheckCircle, AlertTriangle, Globe, Clock, Zap,
  Sliders, Save, ToggleLeft, ToggleRight
} from 'lucide-react';
import { adminAPI } from '../../api/client';

const TYPE_COLORS = {
  'blocklist':              { bg: 'bg-red-500/10',    text: 'text-red-400',    label: 'Blocklist' },
  'rate-limit':             { bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'Rate Limit' },
  'connections-per-minute': { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Conn/min' },
  'too-many-connections':   { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'Max Conns' },
  'behavioral-4xx':         { bg: 'bg-pink-500/10',   text: 'text-pink-400',   label: '4xx Flood' },
  'challenge-fail':         { bg: 'bg-blue-500/10',   text: 'text-blue-400',   label: 'Challenge' },
};

function Badge({ type }) {
  const c = TYPE_COLORS[type] || { bg: 'bg-white/5', text: 'text-white/40', label: type };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function StatCard({ label, value, color, icon: Icon, sub }) {
  return (
    <div className="bg-[#161B22] border border-white/[0.06] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color} opacity-70`} strokeWidth={1.5} />
        <p className="text-xs text-white/40">{label}</p>
      </div>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-white/25 mt-1">{sub}</p>}
    </div>
  );
}

const formatDate = (d) => d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const SOURCE_LABELS = {
  blocklist_de:     'blocklist.de',
  emerging_threats: 'Emerging Threats',
  ci_badguys:       'CI Badguys'
};

export default function AdminDdos() {
  const [tab, setTab] = useState('overview');

  // Data
  const [stats, setStats]         = useState(null);
  const [bans, setBans]           = useState([]);
  const [blocklists, setBlocklists] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [events, setEvents]       = useState([]);
  const [eventStats, setEventStats] = useState([]);

  // UI state
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [message, setMessage]   = useState(null);

  // Filters
  const [filterIp, setFilterIp] = useState('');
  const [filterType, setFilterType] = useState('');

  // Ban form
  const [showBanForm, setShowBanForm] = useState(false);
  const [banForm, setBanForm] = useState({ ip: '', reason: 'manual-ban', durationSec: 3600 });

  // Whitelist form
  const [showWlForm, setShowWlForm] = useState(false);
  const [wlForm, setWlForm] = useState({ cidr: '', description: '' });

  // Challenge types selection
  const [challengeTypes, setChallengeTypes] = useState([]);
  const [ctSaving, setCtSaving] = useState(false);

  const showMsg = (type, text, ms = 4000) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), ms);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, bRes, blRes, wRes, eRes, esRes, ctRes] = await Promise.all([
        adminAPI.getDdosStats(),
        adminAPI.getDdosBans({ ip: filterIp || undefined, limit: 100 }),
        adminAPI.getDdosBlocklists(),
        adminAPI.getDdosWhitelist(),
        adminAPI.getDdosEvents({ limit: 50, attackType: filterType || undefined }),
        adminAPI.getDdosEventStats(),
        adminAPI.getChallengeTypes(),
      ]);
      setStats(sRes.data);
      setBans(bRes.data.bans || []);
      setBlocklists(blRes.data.blocklists || []);
      setWhitelist(wRes.data.whitelist || []);
      setEvents(eRes.data.events || []);
      setEventStats(esRes.data.stats || []);
      setChallengeTypes(ctRes.data.types || []);
    } catch {
      showMsg('error', 'Impossible de charger les données DDoS');
    } finally {
      setLoading(false);
    }
  }, [filterIp, filterType]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh events every 10s on overview tab
  useEffect(() => {
    if (tab !== 'overview') return;
    const id = setInterval(() => {
      adminAPI.getDdosEvents({ limit: 20 }).then(r => setEvents(r.data.events || [])).catch(() => {});
      adminAPI.getDdosStats().then(r => setStats(r.data)).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [tab]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await adminAPI.syncDdosBlocklists();
      showMsg('success', 'Synchronisation lancée (~30s)');
      setTimeout(fetchAll, 10000);
    } catch {
      showMsg('error', 'Échec du lancement de la sync');
    } finally {
      setTimeout(() => setSyncing(false), 2000);
    }
  };

  const handleBan = async () => {
    if (!banForm.ip) return;
    try {
      await adminAPI.createDdosBan(banForm);
      showMsg('success', `IP ${banForm.ip} bannie`);
      setShowBanForm(false);
      setBanForm({ ip: '', reason: 'manual-ban', durationSec: 3600 });
      setTimeout(fetchAll, 300);
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Échec du ban');
    }
  };

  const handleUnban = async (id) => {
    if (!confirm('Débannir cette IP ?')) return;
    try {
      await adminAPI.deleteDdosBan(id);
      setBans(b => b.filter(x => x.id !== id));
      showMsg('success', 'IP débannie');
    } catch {
      showMsg('error', 'Échec du débannissement');
    }
  };

  const handleAddWhitelist = async () => {
    if (!wlForm.cidr) return;
    try {
      await adminAPI.createDdosWhitelist(wlForm);
      showMsg('success', `${wlForm.cidr} ajouté à la whitelist`);
      setShowWlForm(false);
      setWlForm({ cidr: '', description: '' });
      fetchAll();
    } catch (err) {
      showMsg('error', err.response?.data?.error || 'Format invalide (IPv4 ou CIDR ex: 1.2.3.4/24)');
    }
  };

  const handleRemoveWhitelist = async (id) => {
    if (!confirm('Retirer de la whitelist ?')) return;
    try {
      await adminAPI.deleteDdosWhitelist(id);
      setWhitelist(w => w.filter(x => x.id !== id));
      showMsg('success', 'Entrée retirée');
    } catch {
      showMsg('error', 'Échec');
    }
  };

  const toggleChallengeType = (id) => {
    setChallengeTypes(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const toggleAllCategory = (category, enabled) => {
    setChallengeTypes(prev => prev.map(t => t.category === category ? { ...t, enabled } : t));
  };

  const handleSaveChallengeTypes = async () => {
    const enabledIds = challengeTypes.filter(t => t.enabled).map(t => t.id);
    if (enabledIds.length === 0) { showMsg('error', 'Au moins un type de challenge doit rester actif'); return; }
    setCtSaving(true);
    try {
      await adminAPI.setChallengeTypes(enabledIds);
      showMsg('success', `${enabledIds.length} type(s) de challenge sauvegardés`);
    } catch (err) {
      showMsg('error', err.response?.data?.error || 'Échec de la sauvegarde');
    } finally {
      setCtSaving(false);
    }
  };

  const TABS = [
    { id: 'overview',    label: 'Vue d\'ensemble', icon: Activity },
    { id: 'bans',        label: 'Bans actifs',     icon: Ban },
    { id: 'whitelist',   label: 'Whitelist',        icon: CheckCircle },
    { id: 'events',      label: 'Événements',       icon: List },
    { id: 'blocklists',  label: 'Threat Intel',     icon: Database },
    { id: 'challenges',  label: 'Challenges',       icon: Sliders },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#3B82F6]" />
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
          <p className="text-sm text-white/50 mt-0.5">Protection enterprise multi-couche</p>
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
        }`}>{message.text}</div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <StatCard label="Bans actifs"       value={stats.active_bans || 0}                                      color="text-[#EF4444]"  icon={Ban}      />
          <StatCard label="Bloqués 24h"       value={stats.blocked_today || 0}                                    color="text-[#F59E0B]"  icon={Shield}   />
          <StatCard label="Total bans"         value={stats.total_bans || 0}                                       color="text-white"      icon={ShieldAlert} />
          <StatCard label="IPs blocklist"      value={(stats.blocklist_ips || 0).toLocaleString()}                 color="text-[#3B82F6]"  icon={Database} sub={`+ ${stats.blocklist_cidrs || 0} CIDRs`} />
          <StatCard label="Whitelist"          value={stats.whitelist_count || 0}                                  color="text-[#10B981]"  icon={CheckCircle} />
          <StatCard label="Conns actives"      value={stats.active_connections || 0}                               color="text-[#8B5CF6]"  icon={Activity} />
          <StatCard label="Événements 24h"     value={eventStats.reduce((a, s) => a + parseInt(s.count), 0)}      color="text-[#F59E0B]"  icon={Zap}      />
        </div>
      )}

      {/* Attack type breakdown */}
      {eventStats.length > 0 && (
        <div className="bg-[#161B22] border border-white/[0.06] rounded-xl p-4">
          <p className="text-xs font-medium text-white/40 mb-3 uppercase tracking-wider">Types d'attaques (24h)</p>
          <div className="flex flex-wrap gap-3">
            {eventStats.map(s => (
              <div key={s.attack_type} className="flex items-center gap-2">
                <Badge type={s.attack_type} />
                <span className="text-sm font-medium text-white">{parseInt(s.count).toLocaleString()}</span>
                <span className="text-xs text-white/30">({s.unique_ips} IPs)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0D1117] border border-white/[0.06] rounded-xl p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all flex-1 justify-center ${
              tab === id
                ? 'bg-[#1F2937] text-white border border-white/[0.08]'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === 'overview' && (
        <div className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-white/[0.06]">
            <Activity className="w-4 h-4 text-[#3B82F6]" strokeWidth={1.5} />
            <h2 className="text-sm font-medium text-white">Événements récents</h2>
            <span className="ml-auto text-[10px] text-white/25 animate-pulse">● Live</span>
          </div>
          <div className="overflow-x-auto">
            {events.length === 0 ? (
              <div className="p-10 text-center text-white/30 text-sm">
                <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" strokeWidth={1} />
                Aucune attaque détectée
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['IP', 'Domaine', 'Type', 'Détails', 'Date'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-sm font-mono text-white">{ev.ip_address}</td>
                      <td className="px-4 py-2 text-xs text-white/50">{ev.hostname || <span className="text-white/20 italic">Global</span>}</td>
                      <td className="px-4 py-2"><Badge type={ev.attack_type} /></td>
                      <td className="px-4 py-2 text-xs text-white/40 max-w-[200px] truncate font-mono">
                        {ev.details && Object.keys(ev.details).length > 0
                          ? Object.entries(ev.details).map(([k, v]) => `${k}=${v}`).join(' ')
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-white/30">{formatDate(ev.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Bans Tab ── */}
      {tab === 'bans' && (
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
                className="text-xs px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white placeholder-white/30 focus:outline-none w-40"
              />
              <button
                onClick={() => setShowBanForm(!showBanForm)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20 rounded-lg transition-all"
              >
                <Plus className="w-3 h-3" /> Bannir IP
              </button>
            </div>
          </div>

          {showBanForm && (
            <div className="p-4 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <label className="text-xs text-white/40 mb-1 block">Adresse IP ou CIDR</label>
                  <input type="text" placeholder="1.2.3.4" value={banForm.ip}
                    onChange={e => setBanForm(f => ({ ...f, ip: e.target.value }))}
                    className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white placeholder-white/30 focus:outline-none" />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="text-xs text-white/40 mb-1 block">Raison</label>
                  <input type="text" value={banForm.reason}
                    onChange={e => setBanForm(f => ({ ...f, reason: e.target.value }))}
                    className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white focus:outline-none" />
                </div>
                <div className="w-36">
                  <label className="text-xs text-white/40 mb-1 block">Durée (sec) — 0=∞</label>
                  <input type="number" value={banForm.durationSec}
                    onChange={e => setBanForm(f => ({ ...f, durationSec: parseInt(e.target.value) || 3600 }))}
                    className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white focus:outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleBan} className="px-4 py-2 bg-[#EF4444] hover:bg-[#DC2626] text-white text-sm rounded-lg transition-all">Bannir</button>
                  <button onClick={() => setShowBanForm(false)} className="px-3 py-2 text-white/40 hover:text-white text-sm">Annuler</button>
                </div>
              </div>
            </div>
          )}

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
                    {['IP', 'Domaine', 'Raison', 'Par', 'Expire', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bans.map(ban => (
                    <tr key={ban.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-sm font-mono text-white">{ban.ip_address}</td>
                      <td className="px-4 py-2.5 text-xs text-white/50">{ban.hostname || <span className="text-white/20 italic">Global</span>}</td>
                      <td className="px-4 py-2.5 text-xs text-white/50 max-w-[180px] truncate">{ban.reason}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ban.banned_by === 'admin' ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'}`}>
                          {ban.banned_by}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-white/40">
                        {ban.expires_at ? formatDate(ban.expires_at) : '∞ Permanent'}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => handleUnban(ban.id)}
                          className="p-1.5 text-white/30 hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded transition-all"
                          title="Débannir">
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
      )}

      {/* ── Whitelist Tab ── */}
      {tab === 'whitelist' && (
        <div className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
            <h2 className="text-sm font-medium text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[#10B981]" strokeWidth={1.5} />
              Whitelist IP / CIDR
            </h2>
            <button
              onClick={() => setShowWlForm(!showWlForm)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/20 rounded-lg transition-all"
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>

          {showWlForm && (
            <div className="p-4 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-white/40 mb-1 block">IP ou CIDR (ex: 1.2.3.4 ou 10.0.0.0/8)</label>
                  <input type="text" placeholder="1.2.3.4/24" value={wlForm.cidr}
                    onChange={e => setWlForm(f => ({ ...f, cidr: e.target.value }))}
                    className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white placeholder-white/30 focus:outline-none" />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-white/40 mb-1 block">Description</label>
                  <input type="text" placeholder="Mon bureau, CDN Cloudflare..." value={wlForm.description}
                    onChange={e => setWlForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full text-sm px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white placeholder-white/30 focus:outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddWhitelist} className="px-4 py-2 bg-[#10B981] hover:bg-[#059669] text-white text-sm rounded-lg transition-all">Ajouter</button>
                  <button onClick={() => setShowWlForm(false)} className="px-3 py-2 text-white/40 hover:text-white text-sm">Annuler</button>
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            {whitelist.length === 0 ? (
              <div className="p-10 text-center text-white/30 text-sm">
                <Globe className="w-8 h-8 mx-auto mb-3 opacity-20" strokeWidth={1} />
                Whitelist vide — toutes les IPs sont vérifiées
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['IP / CIDR', 'Description', 'Ajouté le', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {whitelist.map(entry => (
                    <tr key={entry.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-sm font-mono text-[#10B981]">{entry.cidr}</td>
                      <td className="px-4 py-2.5 text-xs text-white/50">{entry.description || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-white/40">{formatDate(entry.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => handleRemoveWhitelist(entry.id)}
                          className="p-1.5 text-white/30 hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded transition-all">
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-3 border-t border-white/[0.06] bg-white/[0.01]">
            <p className="text-xs text-white/25">Les IPs et CIDRs de la whitelist ignorent TOUS les contrôles DDoS (blocklists, rate limit, challenge). Utilisez pour vos IPs de confiance (CDN, bureau, monitoring).</p>
          </div>
        </div>
      )}

      {/* ── Events Tab ── */}
      {tab === 'events' && (
        <div className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
            <h2 className="text-sm font-medium text-white flex items-center gap-2">
              <List className="w-4 h-4 text-[#F59E0B]" strokeWidth={1.5} />
              Journal d'attaques
            </h2>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="text-xs px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-lg text-white focus:outline-none"
            >
              <option value="">Tous les types</option>
              {Object.entries(TYPE_COLORS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            {events.length === 0 ? (
              <div className="p-10 text-center text-white/30 text-sm">Aucun événement</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['IP', 'Domaine', 'Type', 'Détails', 'Date'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-sm font-mono text-white">{ev.ip_address}</td>
                      <td className="px-4 py-2 text-xs text-white/50">{ev.hostname || '—'}</td>
                      <td className="px-4 py-2"><Badge type={ev.attack_type} /></td>
                      <td className="px-4 py-2 text-xs text-white/40 max-w-[200px] truncate font-mono">
                        {ev.details && Object.keys(ev.details).length > 0
                          ? Object.entries(ev.details).map(([k, v]) => `${k}=${v}`).join(' ')
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-white/30">{formatDate(ev.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Threat Intel Tab ── */}
      {tab === 'blocklists' && (
        <div className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-white/[0.06]">
            <Database className="w-4 h-4 text-[#3B82F6]" strokeWidth={1.5} />
            <h2 className="text-sm font-medium text-white">Sources Threat Intelligence</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Source', 'Entrées', 'Dernière sync', 'Statut'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-white/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blocklists.map(bl => (
                  <tr key={bl.source} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-white">{SOURCE_LABELS[bl.source] || bl.source}</div>
                      <div className="text-xs text-white/25 mt-0.5 truncate max-w-xs font-mono">{bl.url}</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-white/70">
                      {bl.ip_count ? parseInt(bl.ip_count).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/40">{formatDate(bl.last_fetched)}</td>
                    <td className="px-4 py-3">
                      {bl.last_error ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400" title={bl.last_error}>Erreur</span>
                      ) : bl.last_fetched ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400">OK</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-white/30">En attente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-white/[0.06] bg-white/[0.01] space-y-2">
            <div className="flex items-center gap-4 text-xs text-white/40">
              <span>IPs exactes chargées : <strong className="text-white/60">{(stats?.blocklist_ips || 0).toLocaleString()}</strong></span>
              <span>CIDRs (subnets) : <strong className="text-white/60">{stats?.blocklist_cidrs || 0}</strong></span>
            </div>
            <p className="text-xs text-white/25">Sync automatique toutes les 6h. IPs et CIDRs des listes → ban permanent. Support CIDR complet (ex: 192.168.0.0/16).</p>
          </div>
        </div>
      )}

      {/* ── Challenge Types Tab ── */}
      {tab === 'challenges' && (() => {
        const categories = ['Maths', 'Texte', 'Jeux'];
        const categoryIcons = { Maths: '🧮', Texte: '📝', Jeux: '🎮' };
        const enabledCount = challengeTypes.filter(t => t.enabled).length;
        return (
          <div className="space-y-4">
            {/* Header bar */}
            <div className="bg-[#161B22] border border-white/[0.06] rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Sliders className="w-4 h-4 text-white/40" strokeWidth={1.5} />
                <div>
                  <p className="text-sm font-medium text-white">Types de challenge actifs</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    <span className={`font-semibold ${enabledCount === 0 ? 'text-red-400' : 'text-white/70'}`}>{enabledCount}</span>
                    <span> / {challengeTypes.length} activés — tirés aléatoirement lors du challenge</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setChallengeTypes(prev => prev.map(t => ({ ...t, enabled: true })))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.08] text-white/50 hover:text-white hover:border-white/20 transition-all"
                >
                  Tout activer
                </button>
                <button
                  onClick={handleSaveChallengeTypes}
                  disabled={ctSaving || enabledCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black hover:bg-white/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  {ctSaving ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            </div>

            {/* Category groups */}
            {categories.map(cat => {
              const items = challengeTypes.filter(t => t.category === cat);
              const catEnabled = items.filter(t => t.enabled).length;
              return (
                <div key={cat} className="bg-[#161B22] border border-white/[0.06] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{categoryIcons[cat]}</span>
                      <span className="text-sm font-medium text-white">{cat}</span>
                      <span className="text-xs text-white/30 ml-1">{catEnabled}/{items.length}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => toggleAllCategory(cat, true)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium border border-white/[0.08] text-white/40 hover:text-white hover:border-white/20 transition-all"
                      >Activer tous</button>
                      <button
                        onClick={() => toggleAllCategory(cat, false)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium border border-white/[0.08] text-white/40 hover:text-red-400 hover:border-red-500/30 transition-all"
                      >Désactiver tous</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.03]">
                    {items.map(t => (
                      <button
                        key={t.id}
                        onClick={() => toggleChallengeType(t.id)}
                        className={`flex items-start gap-3 p-4 text-left transition-all group bg-[#161B22] hover:bg-white/[0.02] ${t.enabled ? '' : 'opacity-50'}`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 w-8 h-5 rounded-full relative transition-colors ${t.enabled ? 'bg-white/80' : 'bg-white/10'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-[#161B22] shadow transition-all ${t.enabled ? 'left-3.5' : 'left-0.5'}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white leading-tight">{t.label}</p>
                          <p className="text-[11px] text-white/35 mt-0.5 font-mono leading-snug">{t.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {enabledCount === 0 && (
              <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-xs text-red-400">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Aucun type actif — activez au moins un challenge avant de sauvegarder.
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
