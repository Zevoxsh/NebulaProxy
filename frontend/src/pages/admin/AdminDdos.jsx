import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Ban, RefreshCw, Trash2, Plus, Database, ShieldAlert,
  Activity, List, CheckCircle, Globe, Zap, Sliders, Save, AlertTriangle
} from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent, AdminCardFooter,
  AdminStatCard, AdminButton, AdminBadge, AdminAlert, AdminAlertDescription
} from '@/components/admin';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TYPE_COLORS = {
  'blocklist':              { bg: 'bg-red-500/10',    text: 'text-red-400',    label: 'Blocklist' },
  'rate-limit':             { bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'Rate Limit' },
  'connections-per-minute': { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Conn/min' },
  'too-many-connections':   { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'Max Conns' },
  'behavioral-4xx':         { bg: 'bg-pink-500/10',   text: 'text-pink-400',   label: '4xx Flood' },
  'challenge-fail':         { bg: 'bg-blue-500/10',   text: 'text-blue-400',   label: 'Challenge' },
};

function AttackBadge({ type }) {
  const c = TYPE_COLORS[type] || { bg: 'bg-white/5', text: 'text-white/40', label: type };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
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
  const [stats, setStats]           = useState(null);
  const [bans, setBans]             = useState([]);
  const [blocklists, setBlocklists] = useState([]);
  const [whitelist, setWhitelist]   = useState([]);
  const [events, setEvents]         = useState([]);
  const [eventStats, setEventStats] = useState([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);

  // Filters
  const [filterIp, setFilterIp]     = useState('');
  const [filterType, setFilterType] = useState('');

  // Ban form
  const [showBanForm, setShowBanForm] = useState(false);
  const [banForm, setBanForm]         = useState({ ip: '', reason: 'manual-ban', durationSec: 3600 });

  // Whitelist form
  const [showWlForm, setShowWlForm] = useState(false);
  const [wlForm, setWlForm]         = useState({ cidr: '', description: '' });

  // Challenge types
  const [challengeTypes, setChallengeTypes] = useState([]);
  const [ctSaving, setCtSaving]             = useState(false);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-admin-primary" />
      </div>
    );
  }

  const totalEvents24h = eventStats.reduce((a, s) => a + parseInt(s.count), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-admin-text flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-400" strokeWidth={1.5} />
            Protection Anti-DDoS
          </h1>
          <p className="text-admin-text-muted text-sm mt-1">Protection enterprise multi-couche</p>
        </div>
        <AdminButton variant="secondary" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          Sync Blocklists
        </AdminButton>
      </div>

      {/* Message */}
      {message && (
        <AdminAlert variant={message.type === 'success' ? 'success' : 'danger'}>
          <AdminAlertDescription>{message.text}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <AdminStatCard title="Bans actifs"    value={stats.active_bans || 0}                         icon={Ban}         />
          <AdminStatCard title="Bloqués 24h"    value={stats.blocked_today || 0}                       icon={Shield}      />
          <AdminStatCard title="Total bans"     value={stats.total_bans || 0}                          icon={ShieldAlert} />
          <AdminStatCard title="IPs blocklist"  value={(stats.blocklist_ips || 0).toLocaleString()}    icon={Database}    subtitle={`+ ${stats.blocklist_cidrs || 0} CIDRs`} />
          <AdminStatCard title="Whitelist"      value={stats.whitelist_count || 0}                     icon={CheckCircle} />
          <AdminStatCard title="Conns actives"  value={stats.active_connections || 0}                  icon={Activity}    />
          <AdminStatCard title="Événements 24h" value={totalEvents24h}                                 icon={Zap}         />
        </div>
      )}

      {/* Attack type breakdown */}
      {eventStats.length > 0 && (
        <AdminCard>
          <AdminCardContent className="p-4">
            <p className="text-xs font-medium text-admin-text-muted mb-3 uppercase tracking-wider">Types d'attaques (24h)</p>
            <div className="flex flex-wrap gap-3">
              {eventStats.map(s => (
                <div key={s.attack_type} className="flex items-center gap-2">
                  <AttackBadge type={s.attack_type} />
                  <span className="text-sm font-medium text-admin-text">{parseInt(s.count).toLocaleString()}</span>
                  <span className="text-xs text-admin-text-muted">({s.unique_ips} IPs)</span>
                </div>
              ))}
            </div>
          </AdminCardContent>
        </AdminCard>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full grid grid-cols-6">
          <TabsTrigger value="overview"    className="gap-1.5 text-xs"><Activity    className="w-3.5 h-3.5" />Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="bans"        className="gap-1.5 text-xs"><Ban         className="w-3.5 h-3.5" />Bans actifs</TabsTrigger>
          <TabsTrigger value="whitelist"   className="gap-1.5 text-xs"><CheckCircle className="w-3.5 h-3.5" />Whitelist</TabsTrigger>
          <TabsTrigger value="events"      className="gap-1.5 text-xs"><List        className="w-3.5 h-3.5" />Événements</TabsTrigger>
          <TabsTrigger value="blocklists"  className="gap-1.5 text-xs"><Database    className="w-3.5 h-3.5" />Threat Intel</TabsTrigger>
          <TabsTrigger value="challenges"  className="gap-1.5 text-xs"><Sliders     className="w-3.5 h-3.5" />Challenges</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-4">
          <AdminCard>
            <AdminCardHeader>
              <div className="flex items-center justify-between">
                <AdminCardTitle className="flex items-center gap-2 text-base">
                  <Activity className="w-4 h-4 text-blue-400" strokeWidth={1.5} />
                  Événements récents
                </AdminCardTitle>
                <span className="text-[10px] text-admin-text-muted animate-pulse">● Live</span>
              </div>
            </AdminCardHeader>
            <AdminCardContent className="p-0">
              {events.length === 0 ? (
                <div className="p-10 text-center text-admin-text-muted text-sm">
                  <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" strokeWidth={1} />
                  Aucune attaque détectée
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-admin-border">
                      {['IP', 'Domaine', 'Type', 'Détails', 'Date'].map(h => (
                        <TableHead key={h} className="text-admin-text-muted text-xs">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map(ev => (
                      <TableRow key={ev.id} className="border-admin-border">
                        <TableCell className="font-mono text-sm">{ev.ip_address}</TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{ev.hostname || <span className="italic opacity-50">Global</span>}</TableCell>
                        <TableCell><AttackBadge type={ev.attack_type} /></TableCell>
                        <TableCell className="text-xs text-admin-text-muted max-w-[200px] truncate font-mono">
                          {ev.details && Object.keys(ev.details).length > 0
                            ? Object.entries(ev.details).map(([k, v]) => `${k}=${v}`).join(' ')
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{formatDate(ev.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AdminCardContent>
          </AdminCard>
        </TabsContent>

        {/* ── Bans ── */}
        <TabsContent value="bans" className="mt-4">
          <AdminCard>
            <AdminCardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <AdminCardTitle className="flex items-center gap-2 text-base">
                  <Ban className="w-4 h-4 text-red-400" strokeWidth={1.5} />
                  Bans IP actifs
                </AdminCardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filtrer par IP..."
                    value={filterIp}
                    onChange={e => setFilterIp(e.target.value)}
                    className="bg-admin-bg border-admin-border text-admin-text text-xs w-40 h-8"
                  />
                  <AdminButton variant="danger" size="sm" onClick={() => setShowBanForm(!showBanForm)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Bannir IP
                  </AdminButton>
                </div>
              </div>
            </AdminCardHeader>

            {showBanForm && (
              <div className="px-6 py-4 border-b border-admin-border bg-admin-surface/50">
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-xs text-admin-text-muted mb-1 block">Adresse IP ou CIDR</label>
                    <Input placeholder="1.2.3.4" value={banForm.ip}
                      onChange={e => setBanForm(f => ({ ...f, ip: e.target.value }))}
                      className="bg-admin-bg border-admin-border text-admin-text h-9" />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-xs text-admin-text-muted mb-1 block">Raison</label>
                    <Input value={banForm.reason}
                      onChange={e => setBanForm(f => ({ ...f, reason: e.target.value }))}
                      className="bg-admin-bg border-admin-border text-admin-text h-9" />
                  </div>
                  <div className="w-36">
                    <label className="text-xs text-admin-text-muted mb-1 block">Durée (sec) — 0=∞</label>
                    <Input type="number" value={banForm.durationSec}
                      onChange={e => setBanForm(f => ({ ...f, durationSec: parseInt(e.target.value) || 3600 }))}
                      className="bg-admin-bg border-admin-border text-admin-text h-9" />
                  </div>
                  <div className="flex gap-2">
                    <AdminButton variant="danger" onClick={handleBan}>Bannir</AdminButton>
                    <AdminButton variant="ghost" onClick={() => setShowBanForm(false)}>Annuler</AdminButton>
                  </div>
                </div>
              </div>
            )}

            <AdminCardContent className="p-0">
              {bans.length === 0 ? (
                <div className="p-10 text-center text-admin-text-muted text-sm">
                  <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" strokeWidth={1} />
                  Aucun ban actif
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-admin-border">
                      {['IP', 'Domaine', 'Raison', 'Par', 'Expire', ''].map(h => (
                        <TableHead key={h} className="text-admin-text-muted text-xs">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bans.map(ban => (
                      <TableRow key={ban.id} className="border-admin-border">
                        <TableCell className="font-mono text-sm">{ban.ip_address}</TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{ban.hostname || <span className="italic opacity-50">Global</span>}</TableCell>
                        <TableCell className="text-xs text-admin-text-muted max-w-[180px] truncate">{ban.reason}</TableCell>
                        <TableCell>
                          <AdminBadge variant={ban.banned_by === 'admin' ? 'default' : 'warning'} className="text-[10px]">
                            {ban.banned_by}
                          </AdminBadge>
                        </TableCell>
                        <TableCell className="text-xs text-admin-text-muted">
                          {ban.expires_at ? formatDate(ban.expires_at) : '∞ Permanent'}
                        </TableCell>
                        <TableCell>
                          <AdminButton variant="ghost" size="icon" className="h-8 w-8 hover:text-red-400" onClick={() => handleUnban(ban.id)}>
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </AdminButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AdminCardContent>
          </AdminCard>
        </TabsContent>

        {/* ── Whitelist ── */}
        <TabsContent value="whitelist" className="mt-4">
          <AdminCard>
            <AdminCardHeader>
              <div className="flex items-center justify-between">
                <AdminCardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle className="w-4 h-4 text-green-400" strokeWidth={1.5} />
                  Whitelist IP / CIDR
                </AdminCardTitle>
                <AdminButton variant="success" size="sm" onClick={() => setShowWlForm(!showWlForm)}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Ajouter
                </AdminButton>
              </div>
            </AdminCardHeader>

            {showWlForm && (
              <div className="px-6 py-4 border-b border-admin-border bg-admin-surface/50">
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-xs text-admin-text-muted mb-1 block">IP ou CIDR (ex: 1.2.3.4 ou 10.0.0.0/8)</label>
                    <Input placeholder="1.2.3.4/24" value={wlForm.cidr}
                      onChange={e => setWlForm(f => ({ ...f, cidr: e.target.value }))}
                      className="bg-admin-bg border-admin-border text-admin-text h-9" />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-xs text-admin-text-muted mb-1 block">Description</label>
                    <Input placeholder="Mon bureau, CDN Cloudflare..." value={wlForm.description}
                      onChange={e => setWlForm(f => ({ ...f, description: e.target.value }))}
                      className="bg-admin-bg border-admin-border text-admin-text h-9" />
                  </div>
                  <div className="flex gap-2">
                    <AdminButton variant="success" onClick={handleAddWhitelist}>Ajouter</AdminButton>
                    <AdminButton variant="ghost" onClick={() => setShowWlForm(false)}>Annuler</AdminButton>
                  </div>
                </div>
              </div>
            )}

            <AdminCardContent className="p-0">
              {whitelist.length === 0 ? (
                <div className="p-10 text-center text-admin-text-muted text-sm">
                  <Globe className="w-8 h-8 mx-auto mb-3 opacity-20" strokeWidth={1} />
                  Whitelist vide — toutes les IPs sont vérifiées
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-admin-border">
                      {['IP / CIDR', 'Description', 'Ajouté le', ''].map(h => (
                        <TableHead key={h} className="text-admin-text-muted text-xs">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {whitelist.map(entry => (
                      <TableRow key={entry.id} className="border-admin-border">
                        <TableCell className="font-mono text-sm text-green-400">{entry.cidr}</TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{entry.description || '—'}</TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{formatDate(entry.created_at)}</TableCell>
                        <TableCell>
                          <AdminButton variant="ghost" size="icon" className="h-8 w-8 hover:text-red-400" onClick={() => handleRemoveWhitelist(entry.id)}>
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </AdminButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AdminCardContent>
            <AdminCardFooter className="px-6 py-3">
              <p className="text-xs text-admin-text-muted">Les IPs et CIDRs de la whitelist ignorent TOUS les contrôles DDoS (blocklists, rate limit, challenge). Utilisez pour vos IPs de confiance (CDN, bureau, monitoring).</p>
            </AdminCardFooter>
          </AdminCard>
        </TabsContent>

        {/* ── Events ── */}
        <TabsContent value="events" className="mt-4">
          <AdminCard>
            <AdminCardHeader>
              <div className="flex items-center justify-between">
                <AdminCardTitle className="flex items-center gap-2 text-base">
                  <List className="w-4 h-4 text-yellow-400" strokeWidth={1.5} />
                  Journal d'attaques
                </AdminCardTitle>
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="text-xs px-3 py-1.5 bg-admin-bg border border-admin-border rounded-lg text-admin-text focus:outline-none"
                >
                  <option value="">Tous les types</option>
                  {Object.entries(TYPE_COLORS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </AdminCardHeader>
            <AdminCardContent className="p-0">
              {events.length === 0 ? (
                <div className="p-10 text-center text-admin-text-muted text-sm">Aucun événement</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-admin-border">
                      {['IP', 'Domaine', 'Type', 'Détails', 'Date'].map(h => (
                        <TableHead key={h} className="text-admin-text-muted text-xs">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map(ev => (
                      <TableRow key={ev.id} className="border-admin-border">
                        <TableCell className="font-mono text-sm">{ev.ip_address}</TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{ev.hostname || '—'}</TableCell>
                        <TableCell><AttackBadge type={ev.attack_type} /></TableCell>
                        <TableCell className="text-xs text-admin-text-muted max-w-[200px] truncate font-mono">
                          {ev.details && Object.keys(ev.details).length > 0
                            ? Object.entries(ev.details).map(([k, v]) => `${k}=${v}`).join(' ')
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-admin-text-muted">{formatDate(ev.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AdminCardContent>
          </AdminCard>
        </TabsContent>

        {/* ── Threat Intel ── */}
        <TabsContent value="blocklists" className="mt-4">
          <AdminCard>
            <AdminCardHeader>
              <AdminCardTitle className="flex items-center gap-2 text-base">
                <Database className="w-4 h-4 text-blue-400" strokeWidth={1.5} />
                Sources Threat Intelligence
              </AdminCardTitle>
            </AdminCardHeader>
            <AdminCardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-admin-border">
                    {['Source', 'Entrées', 'Dernière sync', 'Statut'].map(h => (
                      <TableHead key={h} className="text-admin-text-muted text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocklists.map(bl => (
                    <TableRow key={bl.source} className="border-admin-border">
                      <TableCell>
                        <div className="text-sm font-medium">{SOURCE_LABELS[bl.source] || bl.source}</div>
                        <div className="text-xs text-admin-text-muted mt-0.5 truncate max-w-xs font-mono">{bl.url}</div>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {bl.ip_count ? parseInt(bl.ip_count).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-admin-text-muted">{formatDate(bl.last_fetched)}</TableCell>
                      <TableCell>
                        {bl.last_error ? (
                          <AdminBadge variant="danger" title={bl.last_error}>Erreur</AdminBadge>
                        ) : bl.last_fetched ? (
                          <AdminBadge variant="success">OK</AdminBadge>
                        ) : (
                          <AdminBadge variant="secondary">En attente</AdminBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AdminCardContent>
            <AdminCardFooter className="px-6 py-3 space-y-1">
              <div className="flex items-center gap-4 text-xs text-admin-text-muted">
                <span>IPs exactes : <strong className="text-admin-text">{(stats?.blocklist_ips || 0).toLocaleString()}</strong></span>
                <span>CIDRs : <strong className="text-admin-text">{stats?.blocklist_cidrs || 0}</strong></span>
              </div>
              <p className="text-xs text-admin-text-muted">Sync automatique toutes les 6h. Support CIDR complet (ex: 192.168.0.0/16).</p>
            </AdminCardFooter>
          </AdminCard>
        </TabsContent>

        {/* ── Challenges ── */}
        <TabsContent value="challenges" className="mt-4">
          {(() => {
            const categories = ['Maths', 'Texte', 'Jeux'];
            const categoryIcons = { Maths: '🧮', Texte: '📝', Jeux: '🎮' };
            const enabledCount = challengeTypes.filter(t => t.enabled).length;
            return (
              <div className="space-y-4">
                <AdminCard>
                  <AdminCardContent className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <Sliders className="w-4 h-4 text-admin-text-muted" strokeWidth={1.5} />
                        <div>
                          <p className="text-sm font-medium text-admin-text">Types de challenge actifs</p>
                          <p className="text-xs text-admin-text-muted mt-0.5">
                            <span className={`font-semibold ${enabledCount === 0 ? 'text-red-400' : 'text-admin-text'}`}>{enabledCount}</span>
                            {' / '}{challengeTypes.length} activés — tirés aléatoirement lors du challenge
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AdminButton variant="outline" size="sm" onClick={() => setChallengeTypes(prev => prev.map(t => ({ ...t, enabled: true })))}>
                          Tout activer
                        </AdminButton>
                        <AdminButton variant="default" size="sm" onClick={handleSaveChallengeTypes} disabled={ctSaving || enabledCount === 0}>
                          <Save className="w-3.5 h-3.5 mr-1.5" />
                          {ctSaving ? 'Sauvegarde...' : 'Sauvegarder'}
                        </AdminButton>
                      </div>
                    </div>
                  </AdminCardContent>
                </AdminCard>

                {categories.map(cat => {
                  const items = challengeTypes.filter(t => t.category === cat);
                  const catEnabled = items.filter(t => t.enabled).length;
                  return (
                    <AdminCard key={cat}>
                      <AdminCardHeader>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <AdminCardTitle className="flex items-center gap-2 text-base">
                            <span>{categoryIcons[cat]}</span>
                            {cat}
                            <span className="text-xs text-admin-text-muted font-normal ml-1">{catEnabled}/{items.length}</span>
                          </AdminCardTitle>
                          <div className="flex gap-1.5">
                            <AdminButton variant="outline" size="sm" onClick={() => toggleAllCategory(cat, true)}>Activer tous</AdminButton>
                            <AdminButton variant="ghost" size="sm" className="hover:text-red-400" onClick={() => toggleAllCategory(cat, false)}>Désactiver tous</AdminButton>
                          </div>
                        </div>
                      </AdminCardHeader>
                      <AdminCardContent className="p-0">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-admin-border">
                          {items.map(t => (
                            <button
                              key={t.id}
                              onClick={() => toggleChallengeType(t.id)}
                              className={`flex items-start gap-3 p-4 text-left transition-all bg-admin-surface hover:bg-admin-surface2 ${t.enabled ? '' : 'opacity-50'}`}
                            >
                              <div className={`mt-0.5 flex-shrink-0 w-8 h-5 rounded-full relative transition-colors ${t.enabled ? 'bg-admin-primary' : 'bg-admin-border'}`}>
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${t.enabled ? 'left-3.5' : 'left-0.5'}`} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-admin-text leading-tight">{t.label}</p>
                                <p className="text-[11px] text-admin-text-muted mt-0.5 font-mono leading-snug">{t.desc}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </AdminCardContent>
                    </AdminCard>
                  );
                })}

                {enabledCount === 0 && (
                  <AdminAlert variant="danger">
                    <AlertTriangle className="h-4 w-4" />
                    <AdminAlertDescription>Aucun type actif — activez au moins un challenge avant de sauvegarder.</AdminAlertDescription>
                  </AdminAlert>
                )}
              </div>
            );
          })()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
