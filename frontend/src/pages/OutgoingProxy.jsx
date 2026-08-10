import { useEffect, useMemo, useState } from 'react';
import { Network, KeyRound, Plus, RefreshCw, Loader2, AlertCircle, Copy, Check, Trash2, Shuffle, X, Power } from 'lucide-react';
import { socks5ProxyAPI } from '../api/client';
import { useModal } from '../context/ModalContext';

const MB = 1024 * 1024;
const KB = 1024;

function formatThrottle(bps) {
  const n = Number(bps) || 0;
  if (n >= MB) return `${(n / MB).toFixed(n % MB === 0 ? 0 : 1)} MB/s`;
  return `${Math.round(n / KB)} KB/s`;
}

function formatDate(value) {
  if (!value) return 'Jamais';
  return new Date(value).toLocaleString();
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center border flex-shrink-0"
        style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
        <Icon className="w-5 h-5" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-xs text-white/50 font-light">{label}</p>
        <p className="text-xl font-light text-white">{value}</p>
        {sub && <p className="text-xs text-white/40">{sub}</p>}
      </div>
    </div>
  );
}

function RevealModal({ reveal, onClose }) {
  const [copiedField, setCopiedField] = useState(null);

  const copy = (field, text) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
  };

  const Row = ({ field, label, value }) => (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-zinc-500">{label}</span>
        <button onClick={() => copy(field, value)} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors">
          {copiedField === field ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedField === field ? 'Copié' : 'Copier'}
        </button>
      </div>
      <code className="text-sm text-white font-mono break-all">{value}</code>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
            <Check className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Identifiants SOCKS5</p>
            <p className="text-xs text-zinc-500">Copie-les maintenant — le mot de passe ne sera plus jamais affiché.</p>
          </div>
        </div>

        <Row field="host" label="Hôte : Port" value={`${reveal.host}:${reveal.port}`} />
        <Row field="username" label="Nom d'utilisateur" value={reveal.username} />
        <Row field="password" label="Mot de passe" value={reveal.password} />

        <div className="flex items-start gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-4">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/80">Configure ton outil avec ces identifiants (type SOCKS5, authentification obligatoire). Ils ne sont pas récupérables après cet écran — en cas de perte, régénère le mot de passe.</p>
        </div>

        <button onClick={onClose} className="btn-primary w-full text-sm">J&apos;ai sauvegardé mes identifiants</button>
      </div>
    </div>
  );
}

function CreateModal({ maxThrottleBps, defaultThrottleBps, onClose, onCreate }) {
  const [label, setLabel] = useState('');
  const [throttleBps, setThrottleBps] = useState(defaultThrottleBps);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!label.trim()) { setError('Un nom est requis.'); return; }
    try {
      setSubmitting(true);
      setError('');
      await onCreate({ label: label.trim(), throttleBps });
    } catch (err) {
      setError(err.response?.data?.message || 'Échec de la création');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-semibold text-white">Nouvelle configuration SOCKS5</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nom</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Scraper leadfinder" className="input-futuristic text-sm" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-zinc-400">Limite de bande passante</label>
              <span className="text-xs text-white/70 font-mono">{formatThrottle(throttleBps)}</span>
            </div>
            <input
              type="range"
              min={KB * 256}
              max={maxThrottleBps}
              step={KB * 256}
              value={throttleBps}
              onChange={(e) => setThrottleBps(Number(e.target.value))}
              className="w-full accent-[#9D4EDD]"
            />
            <div className="flex justify-between text-[11px] text-white/30 mt-1">
              <span>256 KB/s</span>
              <span>{formatThrottle(maxThrottleBps)} (max)</span>
            </div>
          </div>
        </div>

        <button onClick={submit} disabled={submitting} className="btn-primary w-full text-sm mt-5 flex items-center justify-center gap-2">
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Créer
        </button>
      </div>
    </div>
  );
}

export default function OutgoingProxy() {
  const { confirm: confirmModal, alert: showAlert } = useModal();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState([]);
  const [settings, setSettings] = useState({ enabled: false, port: 1080, publicHost: '', maxThrottleBps: 10 * MB, defaultThrottleBps: 2 * MB, maxCredentialsPerUser: 5 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reveal, setReveal] = useState(null);

  const enabledCount = useMemo(() => credentials.filter((c) => c.is_enabled).length, [credentials]);

  const refresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const response = await socks5ProxyAPI.getAll();
      setCredentials(response.data.credentials || []);
      if (response.data.settings) setSettings(response.data.settings);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger les configurations SOCKS5');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const interval = window.setInterval(refresh, 6000);
    return () => window.clearInterval(interval);
  }, []);

  const handleCreate = async ({ label, throttleBps }) => {
    const response = await socks5ProxyAPI.create({ label, throttleBps });
    setShowCreateModal(false);
    setReveal({
      host: response.data.connection?.host || settings.publicHost || window.location.hostname,
      port: response.data.connection?.port || settings.port,
      username: response.data.credential.username,
      password: response.data.password
    });
    refresh();
  };

  const handleRotate = async (credential) => {
    if (!await confirmModal('Régénérer le mot de passe ? L\'ancien mot de passe cessera immédiatement de fonctionner.', { title: 'Régénérer le mot de passe' })) return;
    try {
      const response = await socks5ProxyAPI.rotatePassword(credential.id);
      setReveal({
        host: settings.publicHost || window.location.hostname,
        port: settings.port,
        username: credential.username,
        password: response.data.password
      });
    } catch (err) {
      await showAlert(err.response?.data?.message || 'Échec de la régénération', { title: 'Erreur', danger: true });
    }
  };

  const handleToggle = async (credential) => {
    try {
      await socks5ProxyAPI.update(credential.id, { isEnabled: !credential.is_enabled });
      refresh();
    } catch (err) {
      await showAlert(err.response?.data?.message || 'Échec de la mise à jour', { title: 'Erreur', danger: true });
    }
  };

  const handleDelete = async (credential) => {
    if (!await confirmModal(`Supprimer "${credential.label}" ? Cette action est irréversible.`, { title: 'Supprimer la configuration', danger: true, confirmLabel: 'Supprimer' })) return;
    try {
      await socks5ProxyAPI.delete(credential.id);
      refresh();
    } catch (err) {
      await showAlert(err.response?.data?.message || 'Échec de la suppression', { title: 'Erreur', danger: true });
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">Proxy sortant</h1>
              <p className="text-sm text-white/50 font-light mt-1">Fais sortir le trafic de tes outils via ce serveur (SOCKS5), avec limite de bande passante par configuration.</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={refresh} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2">
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Actualiser
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={credentials.length >= settings.maxCredentialsPerUser}
                className="btn-primary flex items-center gap-2 text-xs px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                Nouvelle configuration
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body space-y-6">
        {!settings.enabled && (
          <div className="bg-amber-500/10 backdrop-blur-2xl border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-xs text-amber-300 font-light">Le proxy sortant est désactivé par un administrateur — tes configurations sont sauvegardées mais inutilisables tant qu&apos;il n&apos;est pas réactivé.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard icon={Network} label="Configurations" value={credentials.length} sub={`${settings.maxCredentialsPerUser} max.`} />
          <StatCard icon={Power} label="Actives" value={enabledCount} sub="prêtes à l'emploi" />
          <StatCard icon={KeyRound} label="Port d'écoute" value={settings.port} sub="SOCKS5" />
        </div>

        {error && (
          <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-[#F87171] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-xs text-[#F87171] font-light">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-10 text-center text-white/50">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#9D4EDD]" />
            <p className="mt-3 text-sm">Chargement...</p>
          </div>
        ) : credentials.length === 0 ? (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg" style={{ background: '#9D4EDD18', color: '#9D4EDD' }}>
                <Network className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-light text-white">Aucune configuration pour le moment</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">
                Crée une configuration pour obtenir des identifiants SOCKS5 à donner à tes outils.
              </p>
              <div className="mt-6 flex justify-center">
                <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2 text-xs px-4 py-2">
                  <Plus className="w-4 h-4" />
                  Créer une configuration
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {credentials.map((credential) => (
              <div key={credential.id} className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate text-lg font-light text-white">{credential.label}</h3>
                      <span className={credential.is_enabled ? 'badge-success' : 'badge-purple'}>
                        {credential.is_enabled ? 'Active' : 'Désactivée'}
                      </span>
                      {credential.owner_username && (
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/55">{credential.owner_username}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono">{credential.username}</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{formatThrottle(credential.throttle_bps)}</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Dernière utilisation : {formatDate(credential.last_used_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleToggle(credential)} title={credential.is_enabled ? 'Désactiver' : 'Activer'} className="btn-secondary p-2">
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleRotate(credential)} title="Régénérer le mot de passe" className="btn-secondary p-2">
                      <Shuffle className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(credential)} title="Supprimer" className="btn-secondary p-2 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateModal
          maxThrottleBps={settings.maxThrottleBps}
          defaultThrottleBps={settings.defaultThrottleBps}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}

      {reveal && <RevealModal reveal={reveal} onClose={() => setReveal(null)} />}
    </div>
  );
}
