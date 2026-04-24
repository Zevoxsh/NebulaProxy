import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cable, CircleDot, Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle,
  AdminModal,
  AdminModalContent,
  AdminModalDescription,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function SectionButton({ active, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-full border px-4 py-2 text-xs font-medium transition-all ${active ? 'border-admin-primary/30 bg-admin-primary/10 text-admin-primary' : 'border-admin-border bg-admin-surface2 text-admin-text-muted hover:bg-admin-surface hover:text-admin-text'}`}
    >
      {children}
    </button>
  );
}

function buildBindingAccessHint(binding) {
  const host = `${binding.public_hostname}:${binding.public_port}`;
  if (binding.protocol === 'udp') {
    return `udp://${host}`;
  }
  return `tcp://${host}`;
}

export default function TunnelDetail({ mode = 'client' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const basePath = mode === 'admin' ? '/admin/tunnels' : '/tunnels';

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
    if (mode === 'admin') return true;
    if (String(tunnel.user_id) === String(user.id)) return true;
    return (tunnel.access || []).some(
      (entry) => String(entry.user_id) === String(user.id) && entry.role === 'manage'
    );
  }, [mode, tunnel, user]);

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
    if (!autoRefresh) return undefined;

    const interval = window.setInterval(() => {
      loadTunnel({ quiet: true });
    }, 6000);

    return () => window.clearInterval(interval);
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
      setError(err.response?.data?.message || 'Impossible de creer le port');
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
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-white/70">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
          <span className="text-sm">Chargement du tunnel...</span>
        </div>
      </div>
    );
  }

  if (!tunnel) {
    return (
      <AdminCard className="rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
        <AdminCardContent className="p-8">
          <div className="text-sm text-white/55">Tunnel introuvable.</div>
          <AdminButton className="mt-4" variant="secondary" onClick={() => navigate(basePath)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour a la liste
          </AdminButton>
        </AdminCardContent>
      </AdminCard>
    );
  }

  return (
    <div data-admin-theme className="space-y-6 max-w-[1600px] pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate(basePath)}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-admin-text-muted hover:text-admin-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour aux tunnels
          </button>
          <div>
            <h1 className="text-3xl font-semibold text-admin-text md:text-4xl">{tunnel.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-admin-text-muted md:text-base">
              {tunnel.description || 'Aucune description.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-admin-text-muted">
            <span className={`rounded-full border px-3 py-1 ${onlineAgents.length > 0 ? 'border-admin-success/30 bg-admin-success/10 text-admin-success' : 'border-admin-border bg-admin-surface2 text-admin-text-muted'}`}>
              <Wifi className="mr-1 inline h-3 w-3" />
              {onlineAgents.length > 0 ? 'Agent connecte' : 'Agent non connecte'}
            </span>
            <span className="rounded-full border border-admin-border bg-admin-surface2 px-3 py-1">{onlineAgents.length} agent(s) en ligne</span>
            <span className="rounded-full border border-admin-border bg-admin-surface2 px-3 py-1">{tunnel.bindings?.length || 0} port(s) publie(s)</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <AdminButton variant="secondary" onClick={() => loadTunnel()}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser
          </AdminButton>
          <AdminButton
            variant={autoRefresh ? 'secondary' : 'default'}
            onClick={() => setAutoRefresh((value) => !value)}
            className={autoRefresh ? 'border-admin-success/30 bg-admin-success/10 text-admin-success hover:bg-admin-success/15' : ''}
          >
            <CircleDot className="mr-2 h-4 w-4" />
            {autoRefresh ? 'Auto refresh active' : 'Auto refresh inactive'}
          </AdminButton>
          {canManage && (
            <AdminButton
              variant="danger"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Supprimer le tunnel
            </AdminButton>
          )}
        </div>
      </div>

      {error && (
        <AdminAlert variant="destructive">
          <AdminAlertTitle>Erreur</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            <SectionButton active>
              <Cable className="mr-2 inline h-3.5 w-3.5" />
              Ports
            </SectionButton>
          </div>
        </AdminCardContent>
      </AdminCard>

      <div className="space-y-6">
        <AdminCard>
          <AdminCardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <AdminCardTitle className="flex items-center gap-2">
                  <Cable className="h-4 w-4 text-admin-primary" />
                  Ports publies
                </AdminCardTitle>
                <p className="mt-1 text-sm text-admin-text-muted">Ouvre ou ferme les ports du tunnel.</p>
              </div>
              {canManage && (
                <AdminButton onClick={() => setOpenPortModal(true)} className="bg-admin-primary text-admin-primary-foreground hover:opacity-90">
                  <Plus className="mr-2 h-4 w-4" />
                  Ouvrir un port
                </AdminButton>
              )}
            </div>
          </AdminCardHeader>
          <AdminCardContent className="space-y-3 p-6">
            {tunnel.bindings?.length ? (
              <div className="space-y-3">
                {tunnel.bindings.map((binding) => (
                  <div key={binding.id} className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-admin-text">{binding.label}</div>
                        <div className="mt-1 text-xs text-admin-text-muted">
                          {binding.protocol?.toUpperCase()} {binding.target_host}:{binding.local_port} {'->'} {binding.public_hostname}:{binding.public_port}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="rounded-xl border border-admin-border bg-admin-surface px-3 py-2 text-[11px] text-admin-text-muted">
                          {buildBindingAccessHint(binding)}
                        </code>
                        {canManage && (
                          <AdminButton variant="ghost" onClick={() => handleDeleteBinding(binding.id)}>
                            <Trash2 className="h-4 w-4" />
                          </AdminButton>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[180px] items-center justify-center rounded-3xl border border-dashed border-admin-border bg-admin-surface2 p-6 text-center">
                <div className="max-w-md">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-admin-border bg-admin-surface text-admin-text-muted">
                    <Cable className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-admin-text">Aucun port publie</h3>
                  <p className="mt-2 text-sm leading-6 text-admin-text-muted">Ajoute une regle pour exposer un service local.</p>
                  {canManage && (
                    <AdminButton className="mt-4" onClick={() => setOpenPortModal(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Ouvrir mon premier port
                    </AdminButton>
                  )}
                </div>
              </div>
            )}
          </AdminCardContent>
        </AdminCard>
      </div>

      {canManage && (
        <button
          type="button"
          onClick={() => setOpenPortModal(true)}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-admin-primary text-admin-primary-foreground shadow-lg transition hover:scale-105 hover:opacity-90"
          aria-label="Ouvrir un port"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      <AdminModal open={openPortModal} onOpenChange={setOpenPortModal}>
        <AdminModalContent className="max-w-2xl border-admin-border bg-admin-surface text-admin-text">
          <AdminModalHeader>
            <AdminModalTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-admin-primary" />
              Ouvrir un port
            </AdminModalTitle>
            <AdminModalDescription className="text-admin-text-muted">
              Remplis les champs puis valide. Cette fenetre reste au premier plan.
            </AdminModalDescription>
          </AdminModalHeader>

          <div className="pt-2">
            <form className="space-y-4" onSubmit={handleCreateBinding}>
              <div className="space-y-2">
                <Label className="text-admin-text-muted">Nom</Label>
                <Input
                  value={bindingForm.label}
                  onChange={(e) => setBindingForm((current) => ({ ...current, label: e.target.value }))}
                  placeholder="Mon service"
                  className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-admin-text-muted">Protocole</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBindingForm((current) => ({ ...current, protocol: 'tcp' }))}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${bindingForm.protocol === 'tcp' ? 'border-admin-primary/40 bg-admin-primary/10 text-admin-text' : 'border-admin-border bg-admin-surface2 text-admin-text-muted hover:bg-admin-surface'}`}
                    >
                      TCP
                    </button>
                    <button
                      type="button"
                      onClick={() => setBindingForm((current) => ({ ...current, protocol: 'udp' }))}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${bindingForm.protocol === 'udp' ? 'border-admin-primary/40 bg-admin-primary/10 text-admin-text' : 'border-admin-border bg-admin-surface2 text-admin-text-muted hover:bg-admin-surface'}`}
                    >
                      UDP
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-admin-text-muted">Agent</Label>
                  <div className="flex min-h-10 items-center rounded-lg border border-admin-border bg-admin-surface2 px-3 text-sm text-admin-text-muted">
                    {tunnel.agents?.length === 1
                      ? `Selection automatique: ${tunnel.agents[0].name}`
                      : 'Aucun agent detecte.'}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-admin-text-muted">Port local</Label>
                  <Input
                    type="number"
                    min="1"
                    max="65535"
                    value={bindingForm.localPort}
                    onChange={(e) => setBindingForm((current) => ({ ...current, localPort: e.target.value }))}
                    placeholder="80"
                    className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-admin-text-muted">Port public (optionnel)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="65535"
                    value={bindingForm.publicPort}
                    onChange={(e) => setBindingForm((current) => ({ ...current, publicPort: e.target.value }))}
                    placeholder="auto"
                    className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label className="text-admin-text-muted">Host cible</Label>
                  <Input
                    value={bindingForm.targetHost}
                    onChange={(e) => setBindingForm((current) => ({ ...current, targetHost: e.target.value }))}
                    placeholder="127.0.0.1"
                    className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                  />
                </div>
              </div>

              <AdminButton type="submit" disabled={saving || !canManage} className="w-full">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cable className="mr-2 h-4 w-4" />}
                Ouvrir le port
              </AdminButton>
            </form>
          </div>
        </AdminModalContent>
      </AdminModal>

      <AdminModal open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AdminModalContent className="max-w-xl border-admin-border bg-admin-surface text-admin-text">
          <AdminModalHeader>
            <AdminModalTitle>Supprimer le tunnel</AdminModalTitle>
            <AdminModalDescription className="text-admin-text-muted">
              Cette action supprime definitivement {tunnel.name} et ses ports.
            </AdminModalDescription>
          </AdminModalHeader>

          <div className="space-y-3 rounded-2xl border border-admin-danger/30 bg-admin-danger/10 p-4 text-sm text-red-200">
            <p className="font-medium">Cette action est irreversible.</p>
            <p className="text-red-200/70">Les endpoints publics cesseront de fonctionner immediatement.</p>
          </div>

          <AdminModalFooter className="mt-2 border-admin-border">
            <AdminButton variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              Annuler
            </AdminButton>
            <AdminButton variant="danger" onClick={handleDeleteTunnel} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Supprimer le tunnel
            </AdminButton>
          </AdminModalFooter>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
