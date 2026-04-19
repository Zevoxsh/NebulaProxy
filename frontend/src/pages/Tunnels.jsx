import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Cable,
  Check,
  ChevronDown,
  CircleDot,
  Cloud,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Wifi,
  Zap
} from 'lucide-react';
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
  AdminCardTitle
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

const AUTO_REFRESH_MS = 5000;

function StatPill({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const tone = status === 'online'
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
    : 'bg-white/5 text-white/55 border-white/10';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'online' ? 'bg-emerald-300' : 'bg-white/30'}`} />
      {status || 'unknown'}
    </span>
  );
}

function AccessUrl({ url }) {
  return (
    <code className="max-w-full break-all rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/80">
      {url}
    </code>
  );
}

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/70">
          <Icon className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/50">{description}</p>
      </div>
    </div>
  );
}

export default function Tunnels({ mode = 'client' }) {
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tunnels, setTunnels] = useState([]);
  const [error, setError] = useState('');
  const [selectedTunnelId, setSelectedTunnelId] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [enrollmentExpiresAt, setEnrollmentExpiresAt] = useState('');
  const [installCommands, setInstallCommands] = useState({ linux: '', windows: '' });
  const [installPanelOpen, setInstallPanelOpen] = useState(false);
  const [generatingQuickConnect, setGeneratingQuickConnect] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', description: '', provider: 'cloudflare' });
  const [bindingForm, setBindingForm] = useState({ label: '', protocol: 'tcp', localPort: '', publicPort: '', targetHost: '127.0.0.1', agentId: '' });
  const [shareForm, setShareForm] = useState({ userId: '', role: 'view' });

  const selectedTunnel = useMemo(
    () => tunnels.find((tunnel) => String(tunnel.id) === String(selectedTunnelId)) || tunnels[0] || null,
    [tunnels, selectedTunnelId]
  );

  const totalBindings = useMemo(() => tunnels.reduce((acc, tunnel) => acc + (tunnel.bindings?.length || 0), 0), [tunnels]);
  const activeAgents = useMemo(() => selectedTunnel?.agents?.filter((agent) => agent.status === 'online') || [], [selectedTunnel]);
  const hasOnlineAgent = activeAgents.length > 0;

  const refresh = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setRefreshing(true);
      setError('');
      const response = await tunnelsAPI.getAll();
      const nextTunnels = response.data.tunnels || [];
      setTunnels(nextTunnels);

      if (!selectedTunnelId && nextTunnels.length > 0) {
        setSelectedTunnelId(String(nextTunnels[0].id));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger les tunnels');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      refresh({ quiet: true });
    }, AUTO_REFRESH_MS);

    return () => clearInterval(interval);
  }, [autoRefresh, selectedTunnelId]);

  useEffect(() => {
    if (!selectedTunnel) return;

    const preferredAgentId = selectedTunnel.agents?.find((agent) => agent.status === 'online')?.id;
    setBindingForm((current) => ({
      ...current,
      agentId: preferredAgentId ? String(preferredAgentId) : ''
    }));
  }, [selectedTunnelId]);

  useEffect(() => {
    if (hasOnlineAgent) {
      setInstallPanelOpen(false);
    }
  }, [hasOnlineAgent]);

  useEffect(() => {
    if (!selectedTunnelId) return;

    setEnrollmentCode('');
    setEnrollmentExpiresAt('');
    setInstallCommands({ linux: '', windows: '' });
    setCopiedField('');
    setInstallPanelOpen(false);

    handleGenerateCode(selectedTunnelId, true);
  }, [selectedTunnelId]);

  const handleCreateTunnel = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const response = await tunnelsAPI.create(createForm);
      toast({ title: 'Tunnel créé', description: `Tunnel ${response.data.tunnel.name} ajouté` });
      setCreateForm({ name: '', description: '', provider: 'cloudflare' });
      await refresh({ quiet: true });
      setSelectedTunnelId(String(response.data.tunnel.id));
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Impossible de créer le tunnel' });
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateCode = async (tunnelIdOverride = null, silent = false) => {
    const targetTunnelId = tunnelIdOverride || selectedTunnel?.id;
    if (!targetTunnelId) return;

    try {
      setGeneratingQuickConnect(true);
      const response = await tunnelsAPI.generateCode(targetTunnelId, {});
      setEnrollmentCode(response.data.code);
      setEnrollmentExpiresAt(response.data.expiresAt);
      setInstallCommands({
        linux: response.data.linuxCommand || '',
        windows: response.data.windowsCommand || ''
      });
      setInstallPanelOpen(true);

      if (!silent) {
        toast({ title: 'Code généré', description: 'Quick connect prêt' });
      }
    } catch (err) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Impossible de générer le code' });
      }
    } finally {
      setGeneratingQuickConnect(false);
    }
  };

  const handleCopy = async (value, fieldKey) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      toast({ title: 'Copié', description: 'Commande copiée dans le presse-papiers.' });
      setTimeout(() => {
        setCopiedField((current) => (current === fieldKey ? '' : current));
      }, 1500);
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de copier automatiquement.' });
    }
  };

  const handleCreateBinding = async (e) => {
    e.preventDefault();
    if (!selectedTunnel) return;

    try {
      setSaving(true);
      const payload = {
        ...bindingForm,
        localPort: parseInt(bindingForm.localPort, 10),
        publicPort: bindingForm.publicPort ? parseInt(bindingForm.publicPort, 10) : null,
        agentId: bindingForm.agentId ? parseInt(bindingForm.agentId, 10) : null
      };

      const response = await tunnelsAPI.createBinding(selectedTunnel.id, payload);
      toast({ title: 'Port forwarding créé', description: response.data.accessUrl });
      setBindingForm({ label: '', protocol: 'tcp', localPort: '', publicPort: '', targetHost: '127.0.0.1', agentId: '' });
      await refresh({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Impossible de créer le binding' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBinding = async (bindingId) => {
    if (!selectedTunnel) return;

    try {
      await tunnelsAPI.deleteBinding(selectedTunnel.id, bindingId);
      toast({ title: 'Binding supprimé' });
      await refresh({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Impossible de supprimer le binding' });
    }
  };

  const handleGrantAccess = async (e) => {
    e.preventDefault();
    if (!selectedTunnel) return;

    try {
      setSaving(true);
      await tunnelsAPI.grantAccess(selectedTunnel.id, {
        userId: Number.parseInt(String(shareForm.userId || ''), 10),
        role: shareForm.role || 'view'
      });
      toast({ title: 'Accès accordé' });
      await refresh({ quiet: true });
      setShareForm({ userId: '', role: 'view' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || "Impossible d'accorder l'accès" });
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeAccess = async (accessUserId) => {
    if (!selectedTunnel) return;

    try {
      await tunnelsAPI.revokeAccess(selectedTunnel.id, accessUserId);
      toast({ title: 'Accès révoqué' });
      await refresh({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || "Impossible de révoquer l'accès" });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-white/70 shadow-2xl shadow-black/20">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
          <span className="text-sm">Chargement des tunnels...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-6 max-w-[1600px] pb-10">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(251,191,36,0.16),transparent_25%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_30%)]" />
        <div className="pointer-events-none absolute -left-16 top-10 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute right-10 top-0 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              Live tunnel control center
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">Tunnels</h1>
              <p className="max-w-2xl text-sm leading-6 text-white/55 md:text-base">
                {mode === 'admin'
                  ? 'Administration centralisée des agents, bindings, accès partagés et quick connect.'
                  : 'Gère tes agents, ouvre des port forwarding et partage des accès sans quitter le panel.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatPill label="Tunnels" value={tunnels.length} icon={Cloud} />
              <StatPill label="Bindings" value={totalBindings} icon={Cable} />
              <StatPill label="Selected" value={selectedTunnel ? selectedTunnel.name : 'None'} icon={Server} />
              <StatPill label="Refresh" value={autoRefresh ? 'Auto' : 'Manual'} icon={RefreshCw} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 xl:w-[420px] xl:justify-end">
            <AdminButton variant="secondary" onClick={() => refresh()} className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06]">
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh now
            </AdminButton>
            <AdminButton
              variant={autoRefresh ? 'secondary' : 'default'}
              onClick={() => setAutoRefresh((value) => !value)}
              className={autoRefresh ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15' : ''}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {autoRefresh ? 'Auto refresh ON' : 'Auto refresh OFF'}
            </AdminButton>
          </div>
        </div>
      </div>

      {error && (
        <AdminAlert variant="destructive" className="border-red-500/20 bg-red-500/10 text-red-100">
          <AdminAlertTitle>Error</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <AdminCard className="overflow-hidden rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <AdminCardHeader className="border-b border-white/10 bg-white/[0.02]">
            <AdminCardTitle className="flex items-center gap-2 text-white">
              <Plus className="h-4 w-4 text-cyan-300" />
              Create tunnel
            </AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="space-y-5 p-6">
            <form className="space-y-4" onSubmit={handleCreateTunnel}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-white/70">Name</Label>
                  <Input
                    value={createForm.name}
                    onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))}
                    placeholder="workstation-01"
                    className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-white/70">Description</Label>
                  <Textarea
                    value={createForm.description}
                    onChange={(e) => setCreateForm((current) => ({ ...current, description: e.target.value }))}
                    placeholder="Linux host behind NAT"
                    className="min-h-28 border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-white/70">Provider</Label>
                  <Select value={createForm.provider} onValueChange={(value) => setCreateForm((current) => ({ ...current, provider: value }))}>
                    <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cloudflare">Cloudflare</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <AdminButton type="submit" disabled={saving} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create tunnel
              </AdminButton>
            </form>
          </AdminCardContent>
        </AdminCard>

        <AdminCard className="overflow-hidden rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <AdminCardHeader className="border-b border-white/10 bg-white/[0.02]">
            <AdminCardTitle className="flex items-center gap-2 text-white">
              <ArrowUpRight className="h-4 w-4 text-amber-300" />
              Selected tunnel
            </AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="space-y-5 p-6">
            {tunnels.length === 0 ? (
              <EmptyState
                icon={Cloud}
                title="No tunnel yet"
                description="Crée un tunnel pour commencer à gérer des agents, des port forwarding et des accès partagés."
              />
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-white/70">Tunnel</Label>
                  <Select value={selectedTunnel ? String(selectedTunnel.id) : ''} onValueChange={setSelectedTunnelId}>
                    <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                      <SelectValue placeholder="Select a tunnel" />
                    </SelectTrigger>
                    <SelectContent>
                      {tunnels.map((tunnel) => (
                        <SelectItem key={tunnel.id} value={String(tunnel.id)}>
                          {tunnel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedTunnel && (
                  <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Status</div>
                        <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
                          <StatusBadge status={selectedTunnel.status} />
                          <span className="text-white/45">{selectedTunnel.name}</span>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Provider</div>
                        <div className="mt-2 text-sm font-semibold text-white">{selectedTunnel.provider}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Domain</div>
                        <div className="mt-2 break-all text-sm font-semibold text-white">{selectedTunnel.public_domain}</div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/10 via-white/[0.03] to-amber-500/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Zap className="h-4 w-4 text-cyan-300" />
                            Live agent health
                          </div>
                          <p className="mt-1 text-sm text-white/50">
                            {hasOnlineAgent
                              ? `${activeAgents.length} agent(s) online. Quick connect is hidden.`
                              : 'No agent online. Generate a quick connect code to enroll a host.'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <AdminButton
                            type="button"
                            variant="secondary"
                            onClick={() => handleGenerateCode()}
                            disabled={generatingQuickConnect}
                            className="border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.08]"
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            {generatingQuickConnect ? 'Generating...' : 'Quick connect'}
                          </AdminButton>
                          <AdminButton
                            type="button"
                            variant="secondary"
                            onClick={() => setInstallPanelOpen((current) => !current)}
                            className="border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.08]"
                            disabled={hasOnlineAgent}
                          >
                            <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${installPanelOpen ? 'rotate-180' : ''}`} />
                            {hasOnlineAgent ? 'Connected' : installPanelOpen ? 'Hide install' : 'Show install'}
                          </AdminButton>
                        </div>
                      </div>

                      {installPanelOpen && !hasOnlineAgent && (
                        <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Enrollment code</div>
                              <div className="mt-1 text-sm font-mono text-white">{enrollmentCode || 'Generate a code to enroll a new agent'}</div>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                              {enrollmentExpiresAt ? `Expires ${enrollmentExpiresAt}` : 'One-time code'}
                            </div>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-2 flex items-center justify-between text-xs text-white/55">
                                <span>Linux install</span>
                                <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.linux, 'linux')}>
                                  {copiedField === 'linux' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </AdminButton>
                              </div>
                              <code className="block break-all rounded-xl border border-white/10 bg-black/25 p-3 text-[11px] leading-6 text-white/75">
                                {installCommands.linux || 'Generate a code to display the command.'}
                              </code>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-2 flex items-center justify-between text-xs text-white/55">
                                <span>Windows install</span>
                                <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.windows, 'windows')}>
                                  {copiedField === 'windows' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </AdminButton>
                              </div>
                              <code className="block break-all rounded-xl border border-white/10 bg-black/25 p-3 text-[11px] leading-6 text-white/75">
                                {installCommands.windows || 'Generate a code to display the command.'}
                              </code>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Wifi className="h-4 w-4 text-cyan-300" />
                            Agents
                          </div>
                          <div className="text-xs text-white/45">{selectedTunnel.agents?.length || 0} total</div>
                        </div>

                        {selectedTunnel.agents?.length ? (
                          <div className="space-y-2">
                            {selectedTunnel.agents.map((agent) => (
                              <div key={agent.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <div className="text-sm font-medium text-white">{agent.name}</div>
                                      <StatusBadge status={agent.status} />
                                    </div>
                                    <div className="mt-1 text-xs text-white/45">
                                      {agent.platform || 'unknown platform'} · {agent.os_name || 'unknown OS'} · {agent.version || 'n/a'}
                                    </div>
                                  </div>
                                  <div className="text-right text-xs text-white/45">
                                    <div>ID {agent.id}</div>
                                    <div className="mt-1">{agent.last_seen_at || 'never seen'}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyState
                            icon={Wifi}
                            title="No agent connected"
                            description="Generate a quick connect code and run the installer on the host you want to enroll."
                          />
                        )}
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Cable className="h-4 w-4 text-amber-300" />
                            Access URLs
                          </div>
                          <div className="text-xs text-white/45">{selectedTunnel.bindings?.length || 0} binding(s)</div>
                        </div>

                        {selectedTunnel.bindings?.length ? (
                          <div className="space-y-3">
                            {selectedTunnel.bindings.map((binding) => (
                              <div key={binding.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                                      <div className="truncate">{binding.label}</div>
                                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/50">
                                        {binding.protocol}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs text-white/45">
                                      {binding.target_host}:{binding.local_port} · public {binding.public_port}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <AccessUrl url={`${binding.public_hostname}:${binding.public_port}`} />
                                    <AdminButton type="button" variant="ghost" onClick={() => handleDeleteBinding(binding.id)}>
                                      <Trash2 className="h-4 w-4" />
                                    </AdminButton>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyState
                            icon={Cable}
                            title="No port forwarding yet"
                            description="Crée un binding pour exposer un service local via le tunnel sélectionné."
                          />
                        )}
                      </div>
                    </div>

                    {(mode === 'admin' || String(selectedTunnel.user_id) === String(user?.id)) && (
                      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                          <UserPlus className="h-4 w-4 text-emerald-300" />
                          Shared access
                        </div>

                        {selectedTunnel.access?.length ? (
                          <div className="space-y-2">
                            {selectedTunnel.access.map((access) => (
                              <div key={access.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm">
                                <div>
                                  <div className="text-white">{access.display_name || access.username || access.email}</div>
                                  <div className="text-xs text-white/45">Role: {access.role}</div>
                                </div>
                                <AdminButton type="button" variant="ghost" onClick={() => handleRevokeAccess(access.user_id)}>
                                  <Trash2 className="h-4 w-4" />
                                </AdminButton>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-white/45">No explicit shares yet.</div>
                        )}

                        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_auto]" onSubmit={handleGrantAccess}>
                          <Input
                            name="userId"
                            type="number"
                            min="1"
                            placeholder="User ID"
                            value={shareForm.userId}
                            onChange={(e) => setShareForm((current) => ({ ...current, userId: e.target.value }))}
                            className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                          />
                          <Select value={shareForm.role} onValueChange={(value) => setShareForm((current) => ({ ...current, role: value }))}>
                            <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="view">View</SelectItem>
                              <SelectItem value="manage">Manage</SelectItem>
                            </SelectContent>
                          </Select>
                          <AdminButton type="submit" disabled={saving} className="bg-white text-slate-950 hover:bg-white/90">
                            Share
                          </AdminButton>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </AdminCardContent>
        </AdminCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <AdminCard className="overflow-hidden rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <AdminCardHeader className="border-b border-white/10 bg-white/[0.02]">
            <AdminCardTitle className="flex items-center gap-2 text-white">
              <Cable className="h-4 w-4 text-emerald-300" />
              Add port forwarding
            </AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="p-6">
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreateBinding}>
              <div className="space-y-2 md:col-span-2">
                <Label className="text-white/70">Label</Label>
                <Input
                  value={bindingForm.label}
                  onChange={(e) => setBindingForm((current) => ({ ...current, label: e.target.value }))}
                  placeholder="SSH"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/70">Protocol</Label>
                <Select value={bindingForm.protocol} onValueChange={(value) => setBindingForm((current) => ({ ...current, protocol: value }))}>
                  <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-white/70">Local port</Label>
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={bindingForm.localPort}
                  onChange={(e) => setBindingForm((current) => ({ ...current, localPort: e.target.value }))}
                  placeholder="22"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/70">Target host</Label>
                <Input
                  value={bindingForm.targetHost}
                  onChange={(e) => setBindingForm((current) => ({ ...current, targetHost: e.target.value }))}
                  placeholder="127.0.0.1"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/70">Public port</Label>
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={bindingForm.publicPort}
                  onChange={(e) => setBindingForm((current) => ({ ...current, publicPort: e.target.value }))}
                  placeholder="auto"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label className="text-white/70">Agent</Label>
                <Select value={bindingForm.agentId} onValueChange={(value) => setBindingForm((current) => ({ ...current, agentId: value }))}>
                  <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                    <SelectValue placeholder={hasOnlineAgent ? 'Online agent selected automatically' : 'Select an agent (optional)'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Auto-select</SelectItem>
                    {(selectedTunnel?.agents || []).map((agent) => (
                      <SelectItem key={agent.id} value={String(agent.id)}>
                        {agent.name} · {agent.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-white/45">Laisse en auto pour utiliser l’agent en ligne si disponible.</p>
              </div>

              <div className="md:col-span-2">
                <AdminButton type="submit" disabled={saving || !selectedTunnel} className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cable className="mr-2 h-4 w-4" />}
                  Add binding
                </AdminButton>
              </div>
            </form>
          </AdminCardContent>
        </AdminCard>

        <AdminCard className="overflow-hidden rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <AdminCardHeader className="border-b border-white/10 bg-white/[0.02]">
            <AdminCardTitle className="flex items-center gap-2 text-white">
              <Eye className="h-4 w-4 text-amber-300" />
              Live overview
            </AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="space-y-4 p-6">
            {selectedTunnel ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Agent state</div>
                    <div className="mt-2 text-sm font-semibold text-white">{hasOnlineAgent ? 'Connected' : 'Waiting'}</div>
                    <div className="mt-2 text-xs text-white/45">{hasOnlineAgent ? `${activeAgents.length} online` : 'No online agent'}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Open ports</div>
                    <div className="mt-2 text-sm font-semibold text-white">{selectedTunnel.bindings?.length || 0}</div>
                    <div className="mt-2 text-xs text-white/45">Forwarded services</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Access</div>
                    <div className="mt-2 text-sm font-semibold text-white">{selectedTunnel.access?.length || 0}</div>
                    <div className="mt-2 text-xs text-white/45">Shared users</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Public domain</div>
                    <div className="mt-2 break-all text-sm font-semibold text-white">{selectedTunnel.public_domain}</div>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <CircleDot className="h-4 w-4 text-emerald-300" />
                        Runtime posture
                      </div>
                      <p className="mt-1 text-sm text-white/50">
                        {hasOnlineAgent
                          ? 'The panel switches to live mode as soon as an agent is online.'
                          : 'Quick connect commands are hidden until you explicitly reopen them.'}
                      </p>
                    </div>
                    <AdminButton type="button" variant="secondary" onClick={() => refresh({ quiet: false })} className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06]">
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync status
                    </AdminButton>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                icon={Shield}
                title="Select a tunnel"
                description="Choisis un tunnel pour voir ses agents, bindings, accès et commandes de quick connect."
              />
            )}
          </AdminCardContent>
        </AdminCard>
      </div>
    </div>
  );
}
