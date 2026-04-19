import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Cable,
  Check,
  ChevronRight,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

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

function SectionPanel({ title, description, icon: Icon, children, action }) {
  return (
    <AdminCard>
      <AdminCardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AdminCardTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-admin-primary" />
            {title}
          </AdminCardTitle>
          {action}
        </div>
        {description && <p className="text-sm text-admin-text-muted">{description}</p>}
      </AdminCardHeader>
      <AdminCardContent className="p-6">
        {children}
      </AdminCardContent>
    </AdminCard>
  );
}

function EmptyBlock({ icon: Icon, title, description }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-3xl border border-dashed border-admin-border bg-admin-surface2 p-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-admin-border bg-admin-surface text-admin-text-muted">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-admin-text">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-admin-text-muted">{description}</p>
      </div>
    </div>
  );
}

function buildTunnelHostname(tunnel, protocol = 'tcp') {
  const publicSlug = tunnel?.public_slug || tunnel?.publicSlug || tunnel?.id;
  const publicDomain = tunnel?.public_domain || 'tunnel.nebula-app.dev';
  return `${protocol}.${publicSlug}.${publicDomain}`;
}

export default function TunnelDetail({ mode = 'client', section = 'overview' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const basePath = mode === 'admin' ? '/admin/tunnels' : '/tunnels';
  const currentSection = section || 'overview';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState('');
  const [tunnel, setTunnel] = useState(null);
  const [installCode, setInstallCode] = useState('');
  const [installExpiresAt, setInstallExpiresAt] = useState('');
  const [installCommands, setInstallCommands] = useState({ linux: '', windows: '' });
  const [copiedField, setCopiedField] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bindingForm, setBindingForm] = useState({
    label: '',
    protocol: 'tcp',
    localPort: '',
    publicPort: '',
    targetHost: '127.0.0.1',
    agentId: ''
  });
  const [accessForm, setAccessForm] = useState({ userId: '', role: 'view' });

  const detailPath = (nextSection = 'overview') => {
    if (nextSection === 'overview') return `${basePath}/${id}`;
    return `${basePath}/${id}/${nextSection}`;
  };

  const onlineAgents = useMemo(() => tunnel?.agents?.filter((agent) => agent.status === 'online') || [], [tunnel]);
  const canManage = mode === 'admin' || String(tunnel?.user_id) === String(user?.id);

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

    const interval = setInterval(() => {
      loadTunnel({ quiet: true });
    }, 6000);

    return () => clearInterval(interval);
  }, [autoRefresh, id]);

  useEffect(() => {
    if (onlineAgents.length > 0 && currentSection === 'install') {
      setInstallCommands((current) => current);
    }
  }, [onlineAgents.length, currentSection]);

  const handleGenerateCode = async () => {
    try {
      setSaving(true);
      const response = await tunnelsAPI.generateCode(id, {});
      setInstallCode(response.data.code);
      setInstallExpiresAt(response.data.expiresAt);
      setInstallCommands({
        linux: response.data.linuxCommand || '',
        windows: response.data.windowsCommand || ''
      });
      toast({ title: 'Code generated', description: 'Quick connect ready' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Impossible de generer le code' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (value, fieldKey) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      toast({ title: 'Copied', description: 'Command copied to clipboard.' });
      setTimeout(() => {
        setCopiedField((current) => (current === fieldKey ? '' : current));
      }, 1500);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Unable to copy automatically.' });
    }
  };

  const handleCreateBinding = async (e) => {
    e.preventDefault();
    if (!tunnel) return;

    try {
      setSaving(true);
      const payload = {
        ...bindingForm,
        localPort: parseInt(bindingForm.localPort, 10),
        publicPort: bindingForm.publicPort ? parseInt(bindingForm.publicPort, 10) : null,
        agentId: bindingForm.agentId && bindingForm.agentId !== 'auto' ? parseInt(bindingForm.agentId, 10) : null
      };
      await tunnelsAPI.createBinding(tunnel.id, payload);
      toast({ title: 'Binding created' });
      setBindingForm({ label: '', protocol: 'tcp', localPort: '', publicPort: '', targetHost: '127.0.0.1', agentId: '' });
      await loadTunnel({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Impossible de creer le binding' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBinding = async (bindingId) => {
    if (!tunnel) return;
    try {
      await tunnelsAPI.deleteBinding(tunnel.id, bindingId);
      toast({ title: 'Binding deleted' });
      await loadTunnel({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Impossible de supprimer le binding' });
    }
  };

  const handleGrantAccess = async (e) => {
    e.preventDefault();
    if (!tunnel) return;

    try {
      setSaving(true);
      await tunnelsAPI.grantAccess(tunnel.id, {
        userId: Number.parseInt(accessForm.userId, 10),
        role: accessForm.role || 'view'
      });
      toast({ title: 'Access granted' });
      setAccessForm({ userId: '', role: 'view' });
      await loadTunnel({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Impossible d accorder l acces' });
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeAccess = async (userIdToRemove) => {
    if (!tunnel) return;
    try {
      await tunnelsAPI.revokeAccess(tunnel.id, userIdToRemove);
      toast({ title: 'Access revoked' });
      await loadTunnel({ quiet: true });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Impossible de retirer l acces' });
    }
  };

  const handleDeleteTunnel = async () => {
    if (!tunnel) return;

    try {
      setSaving(true);
      await tunnelsAPI.delete(tunnel.id);
      toast({ title: 'Tunnel deleted' });
      navigate(basePath);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Impossible de supprimer le tunnel' });
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
          <span className="text-sm">Loading tunnel...</span>
        </div>
      </div>
    );
  }

  if (!tunnel) {
    return (
      <AdminCard className="rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
        <AdminCardContent className="p-8">
          <div className="text-sm text-white/55">Tunnel not found.</div>
          <AdminButton className="mt-4" variant="secondary" onClick={() => navigate(basePath)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to list
          </AdminButton>
        </AdminCardContent>
      </AdminCard>
    );
  }

  const sections = [
    { key: 'overview', label: 'Overview', icon: Eye },
    { key: 'ports', label: 'Ports', icon: Cable },
    { key: 'access', label: 'Access', icon: UserPlus },
    { key: 'install', label: 'Install', icon: KeyRound }
  ];

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
              Back to tunnels
            </button>
            <div>
              <h1 className="text-3xl font-semibold text-admin-text md:text-4xl">{tunnel.name}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-admin-text-muted md:text-base">
                {tunnel.description || 'No description provided.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-admin-text-muted">
              <span className="rounded-full border border-admin-border bg-admin-surface2 px-3 py-1">{tunnel.provider}</span>
              <span className={`rounded-full border px-3 py-1 ${tunnel.status === 'online' ? 'border-admin-success/30 bg-admin-success/10 text-admin-success' : 'border-admin-border bg-admin-surface2 text-admin-text-muted'}`}>
                {tunnel.status || 'unknown'}
              </span>
              <span className="rounded-full border border-admin-border bg-admin-surface2 px-3 py-1">{onlineAgents.length} online agent(s)</span>
              <span className="rounded-full border border-admin-border bg-admin-surface2 px-3 py-1">{tunnel.bindings?.length || 0} binding(s)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <AdminButton variant="secondary" onClick={() => loadTunnel()}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </AdminButton>
            <AdminButton
              variant={autoRefresh ? 'secondary' : 'default'}
              onClick={() => setAutoRefresh((value) => !value)}
              className={autoRefresh ? 'border-admin-success/30 bg-admin-success/10 text-admin-success hover:bg-admin-success/15' : ''}
            >
              <CircleDot className="mr-2 h-4 w-4" />
              {autoRefresh ? 'Auto refresh on' : 'Auto refresh off'}
            </AdminButton>
            {canManage && (
              <AdminButton
                variant="danger"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete tunnel
              </AdminButton>
            )}
          </div>
      </div>

      {error && (
        <AdminAlert variant="destructive">
          <AdminAlertTitle>Error</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            {sections.map(({ key, label, icon: Icon }) => (
              <SectionButton key={key} active={currentSection === key} onClick={() => navigate(detailPath(key))}>
                <Icon className="mr-2 inline h-3.5 w-3.5" />
                {label}
              </SectionButton>
            ))}
          </div>
        </AdminCardContent>
      </AdminCard>

      {currentSection === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionPanel
            title="Tunnel summary"
            description="Core state, ownership and runtime status."
            icon={Server}
            action={canManage ? null : <span className="rounded-full border border-admin-border bg-admin-surface2 px-3 py-1 text-[11px] text-admin-text-muted">Read only</span>}
          >
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-admin-text-muted">Hostname</div>
                  <div className="mt-2 break-all text-sm font-semibold text-admin-text">{buildTunnelHostname(tunnel)}</div>
                  <div className="mt-2 text-xs text-admin-text-muted">Base domain: {tunnel.public_domain}</div>
                </div>
                <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-admin-text-muted">Owner</div>
                  <div className="mt-2 text-sm font-semibold text-admin-text">User #{tunnel.user_id}</div>
                </div>
                <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-admin-text-muted">Agents</div>
                  <div className="mt-2 text-sm font-semibold text-admin-text">{tunnel.agents?.length || 0}</div>
                </div>
              </div>

              <div className="rounded-3xl border border-admin-border bg-admin-surface2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-admin-text">
                      <Zap className="h-4 w-4 text-admin-primary" />
                      Runtime state
                    </div>
                    <p className="mt-1 text-sm text-admin-text-muted">
                      {onlineAgents.length > 0
                        ? 'At least one agent is online. Use the Ports and Access pages to manage the tunnel.'
                        : 'No online agent yet. Open the Install page to generate an enrollment code.'}
                    </p>
                  </div>
                  <AdminButton variant="secondary" onClick={() => navigate(detailPath('ports'))}>
                    Configure ports
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </AdminButton>
                </div>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="Online agents"
            description="Agents enrolled on this tunnel and their runtime state."
            icon={Wifi}
          >
            <div className="space-y-3">
              {tunnel.agents?.length ? (
                <div className="space-y-3">
                  {tunnel.agents.map((agent) => (
                    <div key={agent.id} className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-admin-text">{agent.name}</div>
                          <div className="mt-1 text-xs text-admin-text-muted">
                            {agent.platform || 'unknown'} · {agent.os_name || 'unknown'} · {agent.version || 'n/a'}
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${agent.status === 'online' ? 'border-admin-success/30 bg-admin-success/10 text-admin-success' : 'border-admin-border bg-admin-surface text-admin-text-muted'}`}>
                          {agent.status || 'unknown'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock icon={Wifi} title="No agents" description="This tunnel does not have any enrolled agent yet." />
              )}
            </div>
          </SectionPanel>
        </div>
      )}

      {currentSection === 'ports' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <SectionPanel title="Port forwarding" description="Every public port bound to this tunnel." icon={Cable}>
            <div className="space-y-3">
              {tunnel.bindings?.length ? (
                <div className="space-y-3">
                  {tunnel.bindings.map((binding) => (
                    <div key={binding.id} className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-admin-text">{binding.label}</div>
                          <div className="mt-1 text-xs text-admin-text-muted">
                            {binding.protocol?.toUpperCase()} {binding.target_host}:{binding.local_port} → {binding.public_hostname}:{binding.public_port}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="rounded-xl border border-admin-border bg-admin-surface px-3 py-2 text-[11px] text-admin-text-muted">
                            {binding.public_hostname}:{binding.public_port}
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
                <EmptyBlock icon={Cable} title="No bindings yet" description="Create a port forwarding rule to expose a local service." />
              )}
            </div>
          </SectionPanel>

          <SectionPanel title="Add binding" description="Create a new forwarding rule." icon={Plus}>
              <form className="space-y-4" onSubmit={handleCreateBinding}>
                <div className="space-y-2">
                  <Label className="text-white/70">Label</Label>
                  <Input
                    value={bindingForm.label}
                    onChange={(e) => setBindingForm((current) => ({ ...current, label: e.target.value }))}
                    placeholder="SSH"
                    className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
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
                    <Label className="text-white/70">Agent</Label>
                    <Select
                      value={bindingForm.agentId || 'auto'}
                      onValueChange={(value) => setBindingForm((current) => ({ ...current, agentId: value === 'auto' ? '' : value }))}
                    >
                      <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                        <SelectValue placeholder="Auto" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-select</SelectItem>
                        {(tunnel.agents || []).map((agent) => (
                          <SelectItem key={agent.id} value={String(agent.id)}>
                            {agent.name} · {agent.status}
                          </SelectItem>
                        ))}
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
                    <Label className="text-white/70">Target host</Label>
                    <Input
                      value={bindingForm.targetHost}
                      onChange={(e) => setBindingForm((current) => ({ ...current, targetHost: e.target.value }))}
                      placeholder="127.0.0.1"
                      className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                    />
                  </div>
                </div>
                <AdminButton type="submit" disabled={saving} className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cable className="mr-2 h-4 w-4" />}
                  Add binding
                </AdminButton>
              </form>
          </SectionPanel>
        </div>
      )}

      {currentSection === 'access' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <SectionPanel title="Shared access" description="People who can view or manage this tunnel." icon={Shield}>
            <div className="space-y-3">
              {tunnel.access?.length ? (
                <div className="space-y-3">
                  {tunnel.access.map((access) => (
                    <div key={access.id} className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-admin-text">{access.display_name || access.username || access.email}</div>
                          <div className="mt-1 text-xs text-admin-text-muted">Role: {access.role}</div>
                        </div>
                        {canManage && (
                          <AdminButton variant="ghost" onClick={() => handleRevokeAccess(access.user_id)}>
                            <Trash2 className="h-4 w-4" />
                          </AdminButton>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock icon={Shield} title="No shared access" description="Grant access to another user if you want them to manage or view this tunnel." />
              )}
            </div>
          </SectionPanel>

          <SectionPanel title="Grant access" description="Invite a user to this tunnel." icon={UserPlus}>
              <form className="space-y-4" onSubmit={handleGrantAccess}>
                <div className="space-y-2">
                    <Label className="text-admin-text-muted">User ID</Label>
                  <Input
                    type="number"
                    min="1"
                    value={accessForm.userId}
                    onChange={(e) => setAccessForm((current) => ({ ...current, userId: e.target.value }))}
                    placeholder="12"
                      className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                  />
                </div>
                <div className="space-y-2">
                    <Label className="text-admin-text-muted">Role</Label>
                  <Select value={accessForm.role} onValueChange={(value) => setAccessForm((current) => ({ ...current, role: value }))}>
                    <SelectTrigger className="border-admin-border bg-admin-surface2 text-admin-text">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View</SelectItem>
                      <SelectItem value="manage">Manage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <AdminButton type="submit" disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  Grant access
                </AdminButton>
              </form>
          </SectionPanel>
        </div>
      )}

      {currentSection === 'install' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionPanel title="Enrollment" description="Generate a code to install another agent." icon={KeyRound}>
            <div className="space-y-4">
              <div className="rounded-3xl border border-admin-border bg-admin-surface2 p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-admin-text-muted">Status</div>
                <p className="mt-2 text-sm text-admin-text-muted">
                  {onlineAgents.length > 0
                    ? 'An agent is already online. You can still generate a new code if you need another machine.'
                    : 'No agent is online yet. Generate a code to enroll a host.'}
                </p>
              </div>
              <AdminButton onClick={handleGenerateCode} disabled={saving} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Generate code
              </AdminButton>
              <div className="rounded-3xl border border-admin-border bg-admin-surface2 p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-admin-text-muted">Enrollment code</div>
                <div className="mt-2 break-all text-sm font-mono text-admin-text">{installCode || 'Click Generate code'}</div>
                <div className="mt-2 text-xs text-admin-text-muted">{installExpiresAt ? `Expires ${installExpiresAt}` : 'One-time code'}</div>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel title="Install commands" description="Copy the command for the target host." icon={Cloud}>
            <div className="space-y-4">
              <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-admin-text-muted">
                  <span>Linux</span>
                  <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.linux, 'linux')}>
                    {copiedField === 'linux' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </AdminButton>
                </div>
                <code className="block break-all rounded-xl border border-admin-border bg-admin-surface p-3 text-[11px] leading-6 text-admin-text-muted">
                  {installCommands.linux || 'Generate a code to display the command.'}
                </code>
              </div>
              <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-admin-text-muted">
                  <span>Windows</span>
                  <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.windows, 'windows')}>
                    {copiedField === 'windows' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </AdminButton>
                </div>
                <code className="block break-all rounded-xl border border-admin-border bg-admin-surface p-3 text-[11px] leading-6 text-admin-text-muted">
                  {installCommands.windows || 'Generate a code to display the command.'}
                </code>
              </div>
            </div>
          </SectionPanel>
        </div>
      )}

      <AdminModal open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AdminModalContent className="max-w-xl border-admin-border bg-admin-surface text-admin-text">
          <AdminModalHeader>
            <AdminModalTitle>Delete tunnel</AdminModalTitle>
            <AdminModalDescription className="text-admin-text-muted">
              This will permanently remove {tunnel.name} and all related bindings, agents, and access shares.
            </AdminModalDescription>
          </AdminModalHeader>

          <div className="space-y-3 rounded-2xl border border-admin-danger/30 bg-admin-danger/10 p-4 text-sm text-red-200">
            <p className="font-medium">This action cannot be undone.</p>
            <p className="text-red-200/70">Public endpoints will stop working immediately after deletion.</p>
          </div>

          <AdminModalFooter className="mt-2 border-admin-border">
            <AdminButton variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="danger" onClick={handleDeleteTunnel} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete tunnel
            </AdminButton>
          </AdminModalFooter>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
