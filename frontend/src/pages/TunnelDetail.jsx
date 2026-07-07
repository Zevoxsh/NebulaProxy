import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cable, CircleDot, Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';

function buildBindingAccessHint(binding) {
  const host = `${binding.public_hostname}:${binding.public_port}`;
  if (binding.protocol === 'udp') {
    return `udp://${host}`;
  }
  return `tcp://${host}`;
}

export default function TunnelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const basePath = '/tunnels';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState('');
  const [tunnel, setTunnel] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [openPortModal, setOpenPortModal] = useState(false);
  const [bindingForm, setBindingForm] = useState({
    label: '',
    protocol: 'tcp',
    localPort: '',
    publicPort: '',
    targetHost: '127.0.0.1',
    agentId: ''
  });

  const canManage = useMemo(() => {
    if (!tunnel || !user) return false;
    if (user.role === 'admin') return true;
    if (String(tunnel.user_id) === String(user.id)) return true;
    return (tunnel.access || []).some(
      (entry) => String(entry.user_id) === String(user.id) && entry.role === 'manage'
    );
  }, [tunnel, user]);

  const onlineAgents = useMemo(() => {
    return (tunnel?.agents || []).filter((agent) => agent.status === 'online');
  }, [tunnel]);

  const loadTunnel = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setRefreshing(true);
      setError('');
      const response = await tunnelsAPI.getOne(id);
      setTunnel(response.data.tunnel);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger le tunnel');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTunnel();
  }, [id]);

  useEffect(() => {
    if (!autoRefresh || document.hidden) return undefined;

    const interval = window.setInterval(() => {
      if (!document.hidden && autoRefresh) {
        loadTunnel({ quiet: true });
      }
    }, 6000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        window.clearInterval(interval);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoRefresh, id]);

  const handleCreateBinding = async (e) => {
    e.preventDefault();
    if (!tunnel) return;

    const singleAgentId = tunnel?.agents?.length === 1 ? tunnel.agents[0].id : null;

    try {
      setSaving(true);
      const payload = {
        ...bindingForm,
        localPort: parseInt(bindingForm.localPort, 10),
        publicPort: bindingForm.publicPort ? parseInt(bindingForm.publicPort, 10) : null,
        agentId: bindingForm.agentId && bindingForm.agentId !== 'auto'
          ? parseInt(bindingForm.agentId, 10)
          : singleAgentId
      };

      await tunnelsAPI.createBinding(tunnel.id, payload);
      setBindingForm({ label: '', protocol: 'tcp', localPort: '', publicPort: '', targetHost: '127.0.0.1', agentId: '' });
      setOpenPortModal(false);
      await loadTunnel({ quiet: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de créer le port');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBinding = async (bindingId) => {
    if (!tunnel) return;

    try {
      await tunnelsAPI.deleteBinding(tunnel.id, bindingId);
      await loadTunnel({ quiet: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de supprimer le port');
    }
  };

  const handleDeleteTunnel = async () => {
    if (!tunnel) return;

    try {
      setSaving(true);
      await tunnelsAPI.delete(tunnel.id);
      navigate(basePath);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de supprimer le tunnel');
    } finally {
      setSaving(false);
      setDeleteDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-white/70">
          <Loader2 className="h-5 w-5 animate-spin text-[#9D4EDD]" />
          <span className="text-sm">Chargement du tunnel...</span>
        </div>
      </div>
    );
  }

  if (!tunnel) {
    return (
      <div className="page-shell">
        <div className="page-body">
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-8">
            <div className="text-sm text-white/55">Tunnel introuvable.</div>
            <button className="btn-secondary flex items-center gap-2 text-xs px-4 py-2 mt-4" onClick={() => navigate(basePath)}>
              <ArrowLeft className="w-4 h-4" />
              Retour à la liste
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate(basePath)}
                className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/40 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Retour aux tunnels
              </button>
              <div>
                <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">{tunnel.name}</h1>
                <p className="text-sm text-white/50 font-light mt-1 max-w-2xl">
                  {tunnel.description || 'Aucune description.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-white/50">
                <span className={onlineAgents.length > 0 ? 'badge-success' : 'badge-purple'}>
                  <Wifi className="mr-1 inline h-3 w-3" />
                  {onlineAgents.length > 0 ? 'Agent connecté' : 'Agent non connecté'}
                </span>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">{onlineAgents.length} agent(s) en ligne</span>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">{tunnel.bindings?.length || 0} port(s) publié(s)</span>
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:flex-wrap">
              <button onClick={() => loadTunnel()} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2 w-full sm:w-auto">
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Actualiser
              </button>
              <button
                onClick={() => setAutoRefresh((value) => !value)}
                className={`flex items-center gap-2 text-xs px-4 py-2 w-full sm:w-auto rounded-lg border transition-all ${autoRefresh ? 'border-[#10B981]/30 bg-[#10B981]/10 text-[#34D399]' : 'border-white/[0.08] bg-white/[0.03] text-white/70 hover:text-white'}`}
              >
                <CircleDot className="w-4 h-4" />
                {autoRefresh ? 'Auto refresh actif' : 'Auto refresh inactif'}
              </button>
              {canManage && (
                <button
                  className="flex items-center gap-2 text-xs px-4 py-2 w-full sm:w-auto rounded-lg text-[#F87171] hover:bg-[#EF4444]/10 border border-[#EF4444]/20 transition-all"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer le tunnel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page-body space-y-6">
        {error && (
          <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4">
            <p className="text-xs text-[#F87171] font-light">{error}</p>
          </div>
        )}

        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
              style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
              <Cable className="w-4 h-4" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Ports publiés</p>
              <p className="text-xs text-white/50">Ouvre ou ferme les ports du tunnel.</p>
            </div>
            {canManage && (
              <button onClick={() => setOpenPortModal(true)} className="btn-primary flex items-center gap-2 text-xs px-4 py-2 ml-auto">
                <Plus className="w-4 h-4" />
                Ouvrir un port
              </button>
            )}
          </div>
          <div className="p-6">
            {tunnel.bindings?.length ? (
              <div className="space-y-3">
                {tunnel.bindings.map((binding) => (
                  <div key={binding.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{binding.label}</div>
                        <div className="mt-1 text-xs text-white/50">
                          {binding.protocol?.toUpperCase()} {binding.target_host}:{binding.local_port} {'->'} {binding.public_hostname}:{binding.public_port}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[11px] text-white/50">
                          {buildBindingAccessHint(binding)}
                        </code>
                        {canManage && (
                          <button onClick={() => handleDeleteBinding(binding.id)} className="p-2 rounded-lg text-[#F87171] hover:bg-[#EF4444]/10 transition-all">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
                <div className="max-w-md">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/50">
                    <Cable className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-base font-light text-white">Aucun port publié</h3>
                  <p className="mt-2 text-sm leading-6 text-white/50">Ajoute une règle pour exposer un service local.</p>
                  {canManage && (
                    <button className="btn-primary flex items-center gap-2 text-xs px-4 py-2 mt-4 mx-auto" onClick={() => setOpenPortModal(true)}>
                      <Plus className="w-4 h-4" />
                      Ouvrir mon premier port
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {canManage && (
        <button
          type="button"
          onClick={() => setOpenPortModal(true)}
          className="fixed bottom-6 right-6 z-40 hidden h-14 w-14 items-center justify-center rounded-full bg-[#9D4EDD] text-white shadow-lg transition hover:scale-105 hover:opacity-90 sm:flex"
          aria-label="Ouvrir un port"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {openPortModal && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-2xl w-full animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-light text-white flex items-center gap-2">
                <Plus className="h-4 w-4" style={{ color: '#9D4EDD' }} />
                Ouvrir un port
              </h2>
              <button onClick={() => setOpenPortModal(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300">
                ✕
              </button>
            </div>
            <p className="text-xs text-white/50 mb-4 -mt-3">Remplis les champs puis valide.</p>

            <form className="space-y-4" onSubmit={handleCreateBinding}>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Nom</label>
                <input
                  value={bindingForm.label}
                  onChange={(e) => setBindingForm((current) => ({ ...current, label: e.target.value }))}
                  placeholder="Mon service"
                  className="input-futuristic text-xs"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Protocole</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBindingForm((current) => ({ ...current, protocol: 'tcp' }))}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${bindingForm.protocol === 'tcp' ? 'border-[#9D4EDD]/40 bg-[#9D4EDD]/10 text-white' : 'border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white'}`}
                    >
                      TCP
                    </button>
                    <button
                      type="button"
                      onClick={() => setBindingForm((current) => ({ ...current, protocol: 'udp' }))}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${bindingForm.protocol === 'udp' ? 'border-[#9D4EDD]/40 bg-[#9D4EDD]/10 text-white' : 'border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white'}`}
                    >
                      UDP
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Agent</label>
                  <div className="flex min-h-10 items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/50">
                    {tunnel.agents?.length === 1
                      ? `Sélection automatique : ${tunnel.agents[0].name}`
                      : 'Aucun agent détecté.'}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Port local</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={bindingForm.localPort}
                    onChange={(e) => setBindingForm((current) => ({ ...current, localPort: e.target.value }))}
                    placeholder="80"
                    className="input-futuristic text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Port public (optionnel)</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={bindingForm.publicPort}
                    onChange={(e) => setBindingForm((current) => ({ ...current, publicPort: e.target.value }))}
                    placeholder="auto"
                    className="input-futuristic text-xs"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Host cible</label>
                  <input
                    value={bindingForm.targetHost}
                    onChange={(e) => setBindingForm((current) => ({ ...current, targetHost: e.target.value }))}
                    placeholder="127.0.0.1"
                    className="input-futuristic text-xs"
                  />
                </div>
              </div>

              <button type="submit" disabled={saving || !canManage} className="btn-primary w-full text-sm py-3 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cable className="w-4 h-4" />}
                Ouvrir le port
              </button>
            </form>
          </div>
        </div>
      )}

      {deleteDialogOpen && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-xl w-full animate-scale-in">
            <h2 className="text-base font-light text-white mb-1">Supprimer le tunnel</h2>
            <p className="text-xs text-white/50 mb-4">
              Cette action supprime définitivement {tunnel.name} et ses ports.
            </p>

            <div className="space-y-2 rounded-xl border border-[#EF4444]/20 bg-[#EF4444]/10 p-4 text-sm text-[#F87171]">
              <p className="font-medium">Cette action est irréversible.</p>
              <p className="text-[#F87171]/70">Les endpoints publics cesseront de fonctionner immédiatement.</p>
            </div>

            <div className="flex gap-3 pt-4">
              <button className="btn-secondary flex-1 text-xs px-4 py-2.5" onClick={() => setDeleteDialogOpen(false)}>
                Annuler
              </button>
              <button
                className="flex-1 text-xs px-4 py-2.5 rounded-lg bg-[#EF4444]/20 text-[#F87171] hover:bg-[#EF4444]/30 border border-[#EF4444]/30 transition-all flex items-center justify-center gap-2"
                onClick={handleDeleteTunnel}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Supprimer le tunnel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
