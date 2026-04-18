import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Link2, Trash2, KeyRound, Server, Cable, Copy, Check } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

function AccessUrl({ url }) {
  return <code className="rounded-md bg-admin-bg-secondary px-2 py-1 text-xs text-admin-text break-all">{url}</code>;
}

export default function Tunnels({ mode = 'client' }) {
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tunnels, setTunnels] = useState([]);
  const [error, setError] = useState('');
  const [selectedTunnelId, setSelectedTunnelId] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [enrollmentExpiresAt, setEnrollmentExpiresAt] = useState('');
  const [installCommands, setInstallCommands] = useState({ linux: '', windows: '' });
  const [generatingQuickConnect, setGeneratingQuickConnect] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', description: '', provider: 'cloudflare' });
  const [bindingForm, setBindingForm] = useState({ label: '', protocol: 'tcp', localPort: '', publicPort: '', targetHost: '127.0.0.1' });
  const [shareForm, setShareForm] = useState({ userId: '', role: 'view' });

  const selectedTunnel = useMemo(
    () => tunnels.find((tunnel) => String(tunnel.id) === String(selectedTunnelId)) || tunnels[0] || null,
    [tunnels, selectedTunnelId]
  );

  const refresh = async () => {
    try {
      setLoading(true);
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
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleCreateTunnel = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const response = await tunnelsAPI.create(createForm);
      toast({ title: 'Tunnel créé', description: `Tunnel ${response.data.tunnel.name} ajouté` });
      setCreateForm({ name: '', description: '', provider: 'cloudflare' });
      await refresh();
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
      if (!silent) {
        toast({ title: 'Code généré', description: 'Code de quick connect prêt' });
      }
    } catch (err) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Impossible de générer le code' });
      }
    } finally {
      setGeneratingQuickConnect(false);
    }
  };

  useEffect(() => {
    if (!selectedTunnelId) return;

    setEnrollmentCode('');
    setEnrollmentExpiresAt('');
    setInstallCommands({ linux: '', windows: '' });
    setCopiedField('');

    // Auto-generate one-time quick-connect commands for the selected tunnel.
    handleGenerateCode(selectedTunnelId, true);
  }, [selectedTunnelId]);

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
        publicPort: bindingForm.publicPort ? parseInt(bindingForm.publicPort, 10) : null
      };
      const response = await tunnelsAPI.createBinding(selectedTunnel.id, payload);
      toast({ title: 'Binding ajouté', description: response.data.accessUrl });
      setBindingForm({ label: '', protocol: 'tcp', localPort: '', publicPort: '', targetHost: '127.0.0.1' });
      await refresh();
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
      await refresh();
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
      await refresh();
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
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || "Impossible de révoquer l'accès" });
    }
  };

  if (loading) {
    return <div className="text-admin-text-muted">Loading tunnels...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text">Tunnels</h1>
          <p className="text-admin-text-muted mt-1">
            {mode === 'admin'
              ? 'Administration des tunnels, accès partagés et quick connect.'
              : 'Quick connect, agents, port bindings, and shared access.'}
          </p>
        </div>
        <AdminButton variant="secondary" onClick={refresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </AdminButton>
      </div>

      {error && (
        <AdminAlert variant="destructive">
          <AdminAlertTitle>Error</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>Create Tunnel</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent>
            <form className="space-y-4" onSubmit={handleCreateTunnel}>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={createForm.name} onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))} placeholder="workstation-01" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={createForm.description} onChange={(e) => setCreateForm((s) => ({ ...s, description: e.target.value }))} placeholder="Linux host behind NAT" />
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={createForm.provider} onValueChange={(value) => setCreateForm((s) => ({ ...s, provider: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <AdminButton type="submit" disabled={saving} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Create Tunnel'}
              </AdminButton>
            </form>
          </AdminCardContent>
        </AdminCard>

        <div className="space-y-6">
          <AdminCard>
            <AdminCardHeader>
              <AdminCardTitle>Existing Tunnels</AdminCardTitle>
            </AdminCardHeader>
            <AdminCardContent>
              {tunnels.length === 0 ? (
                <div className="text-admin-text-muted text-sm">No tunnel yet.</div>
              ) : (
                <div className="space-y-3">
                  <Select value={selectedTunnel ? String(selectedTunnel.id) : ''} onValueChange={setSelectedTunnelId}>
                    <SelectTrigger><SelectValue placeholder="Select a tunnel" /></SelectTrigger>
                    <SelectContent>
                      {tunnels.map((tunnel) => (
                        <SelectItem key={tunnel.id} value={String(tunnel.id)}>{tunnel.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedTunnel && (
                    <div className="space-y-4 pt-2">
                      <div className="grid gap-3 md:grid-cols-3 text-sm">
                        <div className="rounded-lg border border-admin-border p-3">
                          <div className="text-admin-text-muted">Status</div>
                          <div className="font-medium text-admin-text">{selectedTunnel.status}</div>
                        </div>
                        <div className="rounded-lg border border-admin-border p-3">
                          <div className="text-admin-text-muted">Provider</div>
                          <div className="font-medium text-admin-text">{selectedTunnel.provider}</div>
                        </div>
                        <div className="rounded-lg border border-admin-border p-3">
                          <div className="text-admin-text-muted">Domain</div>
                          <div className="font-medium text-admin-text break-all">{selectedTunnel.public_domain}</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <AdminButton type="button" onClick={() => handleGenerateCode()} disabled={generatingQuickConnect}>
                          <KeyRound className="w-4 h-4 mr-2" />
                          {generatingQuickConnect ? 'Generating...' : 'Regenerate Quick Connect'}
                        </AdminButton>
                        <div className="text-xs text-admin-text-muted flex items-center gap-2"><Link2 className="w-3 h-3" />{selectedTunnel.bindings?.length || 0} binding(s)</div>
                      </div>

                      {enrollmentCode && (
                        <div className="rounded-lg border border-admin-border bg-admin-bg-secondary p-3 text-sm space-y-2">
                          <div className="text-admin-text-muted">Enrollment code</div>
                          <code className="block break-all text-admin-text">{enrollmentCode}</code>
                          <div className="text-xs text-admin-text-muted">Expires: {enrollmentExpiresAt}</div>
                          <div className="text-xs text-admin-text-muted">Cette commande est liée a ce tunnel et donc au compte proprietaire du tunnel.</div>

                          {installCommands.linux && (
                            <div className="space-y-1 pt-2">
                              <div className="text-admin-text-muted flex items-center justify-between gap-2">
                                <span>Linux one-liner</span>
                                <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.linux, 'linux')}>
                                  {copiedField === 'linux' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </AdminButton>
                              </div>
                              <code className="block break-all text-admin-text">{installCommands.linux}</code>
                            </div>
                          )}

                          {installCommands.windows && (
                            <div className="space-y-1 pt-2">
                              <div className="text-admin-text-muted flex items-center justify-between gap-2">
                                <span>Windows one-liner</span>
                                <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.windows, 'windows')}>
                                  {copiedField === 'windows' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </AdminButton>
                              </div>
                              <code className="block break-all text-admin-text">{installCommands.windows}</code>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="rounded-lg border border-admin-border p-3 space-y-2">
                        <div className="flex items-center gap-2 text-admin-text font-medium"><Server className="w-4 h-4" />Access URLs</div>
                        {selectedTunnel.bindings?.length ? selectedTunnel.bindings.map((binding) => (
                          <div key={binding.id} className="flex items-center justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <div className="text-admin-text">{binding.label}</div>
                              <div className="text-admin-text-muted">{binding.protocol.toUpperCase()} {binding.local_port} → {binding.target_host}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <AccessUrl url={`${binding.public_hostname}:${binding.public_port}`} />
                              <AdminButton type="button" variant="ghost" onClick={() => handleDeleteBinding(binding.id)}>
                                <Trash2 className="w-4 h-4" />
                              </AdminButton>
                            </div>
                          </div>
                        )) : <div className="text-admin-text-muted text-sm">No binding yet.</div>}
                      </div>

                      {(mode === 'admin' || String(selectedTunnel.user_id) === String(user?.id)) && (
                        <div className="rounded-lg border border-admin-border p-3 space-y-3">
                          <div className="text-admin-text font-medium">Shared access</div>
                          {selectedTunnel.access?.length ? (
                            <div className="space-y-2">
                              {selectedTunnel.access.map((access) => (
                                <div key={access.id} className="flex items-center justify-between gap-3 text-sm">
                                  <div>
                                    <div className="text-admin-text">{access.display_name || access.username || access.email}</div>
                                    <div className="text-admin-text-muted">Role: {access.role}</div>
                                  </div>
                                  <AdminButton type="button" variant="ghost" onClick={() => handleRevokeAccess(access.user_id)}>
                                    <Trash2 className="w-4 h-4" />
                                  </AdminButton>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-admin-text-muted text-sm">No explicit shares yet.</div>
                          )}

                          <form className="grid gap-3 md:grid-cols-[1fr_160px_auto]" onSubmit={handleGrantAccess}>
                            <Input
                              name="userId"
                              type="number"
                              min="1"
                              placeholder="User ID"
                              value={shareForm.userId}
                              onChange={(e) => setShareForm((current) => ({ ...current, userId: e.target.value }))}
                            />
                            <Select value={shareForm.role} onValueChange={(value) => setShareForm((current) => ({ ...current, role: value }))}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="view">View</SelectItem>
                                <SelectItem value="manage">Manage</SelectItem>
                              </SelectContent>
                            </Select>
                            <AdminButton type="submit" disabled={saving}>Share</AdminButton>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </AdminCardContent>
          </AdminCard>

          <AdminCard>
            <AdminCardHeader>
              <AdminCardTitle>Add Port Binding</AdminCardTitle>
            </AdminCardHeader>
            <AdminCardContent>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreateBinding}>
                <div className="space-y-2 md:col-span-2">
                  <Label>Label</Label>
                  <Input value={bindingForm.label} onChange={(e) => setBindingForm((s) => ({ ...s, label: e.target.value }))} placeholder="SSH" />
                </div>
                <div className="space-y-2">
                  <Label>Protocol</Label>
                  <Select value={bindingForm.protocol} onValueChange={(value) => setBindingForm((s) => ({ ...s, protocol: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Local port</Label>
                  <Input type="number" min="1" max="65535" value={bindingForm.localPort} onChange={(e) => setBindingForm((s) => ({ ...s, localPort: e.target.value }))} placeholder="22" />
                </div>
                <div className="space-y-2">
                  <Label>Target host</Label>
                  <Input value={bindingForm.targetHost} onChange={(e) => setBindingForm((s) => ({ ...s, targetHost: e.target.value }))} placeholder="127.0.0.1" />
                </div>
                <div className="space-y-2">
                  <Label>Public port</Label>
                  <Input type="number" min="1" max="65535" value={bindingForm.publicPort} onChange={(e) => setBindingForm((s) => ({ ...s, publicPort: e.target.value }))} placeholder="auto" />
                </div>
                <div className="md:col-span-2">
                  <AdminButton type="submit" disabled={saving || !selectedTunnel} className="w-full">
                    <Cable className="w-4 h-4 mr-2" />
                    Add Binding
                  </AdminButton>
                </div>
              </form>
            </AdminCardContent>
          </AdminCard>
        </div>
      </div>
    </div>
  );
}