import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Network, Plus, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { ipsecAPI } from '../../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminBadge,
  AdminStatCard,
  AdminModal,
  AdminModalContent,
  AdminModalHeader,
  AdminModalTitle,
  AdminModalFooter
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const emptyForm = {
  name: '', mode: 'server', localSubnet: '', remoteSubnet: '', remoteAddr: '',
  localId: '', remoteId: ''
};

export default function AdminIPsecList() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tunnels, setTunnels] = useState([]);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const refresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const response = await ipsecAPI.getAll();
      setTunnels(response.data.tunnels || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger les tunnels IPsec');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 8000);
    return () => window.clearInterval(interval);
  }, []);

  const runningCount = tunnels.filter((t) => t.running).length;

  const openCreate = () => {
    setForm(emptyForm);
    setFormError('');
    setCreating(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (form.mode === 'client' && !form.remoteAddr.trim()) {
      setFormError('Adresse distante requise en mode client');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        mode: form.mode,
        localSubnet: form.localSubnet.trim(),
        remoteSubnet: form.remoteSubnet.trim()
      };
      if (form.remoteAddr) payload.remoteAddr = form.remoteAddr.trim();
      if (form.localId) payload.localId = form.localId.trim();
      if (form.remoteId) payload.remoteId = form.remoteId.trim();

      const response = await ipsecAPI.create(payload);
      setCreating(false);
      navigate(`/admin/ipsec/${response.data.tunnel.id}`);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Impossible de creer le tunnel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-admin-theme className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="mb-2 text-3xl font-semibold text-admin-text md:text-4xl">IPsec</h1>
          <p className="text-sm leading-6 text-admin-text-muted md:text-base">
            Tunnels IPsec (IKEv2 / cle pre-partagee) — client ou serveur, pour la connectivite inter-sites.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:flex-wrap">
          <AdminButton variant="secondary" onClick={refresh} className="w-full sm:w-auto">
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser
          </AdminButton>
          <AdminButton onClick={openCreate} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Nouveau tunnel
          </AdminButton>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminStatCard title="Tunnels" value={tunnels.length} subtitle="configures" icon={Network} />
        <AdminStatCard title="Actifs" value={runningCount} subtitle="SA etablies" icon={Wifi} />
        <AdminStatCard title="Serveurs" value={tunnels.filter((t) => t.mode === 'server').length} subtitle="en attente de connexions" icon={ChevronRight} />
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AdminAlertTitle>Erreur</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {loading ? (
        <AdminCard>
          <AdminCardContent className="p-10 text-center text-admin-text-muted">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-admin-primary" />
            <p className="mt-3 text-sm">Chargement...</p>
          </AdminCardContent>
        </AdminCard>
      ) : tunnels.length === 0 ? (
        <AdminCard>
          <AdminCardContent className="p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-admin-primary/10 text-admin-primary">
                <Network className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-admin-text">Aucun tunnel IPsec</h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">
                Cree un tunnel site-a-site — client ou serveur, avec les sous-reseaux locaux et distants.
              </p>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <AdminButton onClick={openCreate} className="w-full sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Creer un tunnel
                </AdminButton>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>
      ) : (
        <div className="grid gap-4">
          {tunnels.map((tunnel) => (
            <button
              key={tunnel.id}
              type="button"
              onClick={() => navigate(`/admin/ipsec/${tunnel.id}`)}
              className="group text-left"
            >
              <AdminCard className="transition-all duration-200 group-hover:border-admin-primary/30 group-hover:shadow-md">
                <AdminCardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate text-lg font-semibold text-admin-text">{tunnel.name}</h3>
                      <AdminBadge variant={tunnel.running ? 'success' : 'secondary'}>
                        {tunnel.running ? (
                          <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> Actif</span>
                        ) : (
                          <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Arrete</span>
                        )}
                      </AdminBadge>
                      <AdminBadge variant="secondary">{tunnel.mode === 'server' ? 'Serveur' : 'Client'}</AdminBadge>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-admin-text-muted">
                      <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.conn_name}</span>
                      <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.local_subnet} &lt;-&gt; {tunnel.remote_subnet}</span>
                      {tunnel.remote_addr && <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.remote_addr}</span>}
                    </div>
                  </div>

                  <div className="rounded-lg border border-admin-border bg-admin-surface2 p-3 text-admin-text-muted transition-all group-hover:bg-admin-surface">
                    <ChevronRight className="h-5 w-5" />
                  </div>
                </AdminCardContent>
              </AdminCard>
            </button>
          ))}
        </div>
      )}

      <AdminModal open={creating} onOpenChange={setCreating}>
        <AdminModalContent>
          <AdminModalHeader>
            <AdminModalTitle>Nouveau tunnel IPsec</AdminModalTitle>
          </AdminModalHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              {formError && (
                <AdminAlert variant="danger">
                  <AdminAlertDescription>{formError}</AdminAlertDescription>
                </AdminAlert>
              )}
              <div className="space-y-2">
                <Label className="text-admin-text">Nom</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  placeholder="Site Paris <-> Site Lyon"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Mode</Label>
                <select
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text"
                >
                  <option value="server">Serveur (attend les connexions entrantes)</option>
                  <option value="client">Client (se connecte a une passerelle distante)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Sous-reseau local</Label>
                  <Input
                    value={form.localSubnet}
                    onChange={(e) => setForm({ ...form, localSubnet: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text font-mono"
                    placeholder="10.10.0.0/24"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Sous-reseau distant</Label>
                  <Input
                    value={form.remoteSubnet}
                    onChange={(e) => setForm({ ...form, remoteSubnet: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text font-mono"
                    placeholder="10.20.0.0/24"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">
                  Adresse distante {form.mode === 'client' ? '' : '(optionnel — restreint qui peut se connecter)'}
                </Label>
                <Input
                  value={form.remoteAddr}
                  onChange={(e) => setForm({ ...form, remoteAddr: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                  placeholder="203.0.113.10"
                  required={form.mode === 'client'}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Identite locale (optionnel)</Label>
                  <Input
                    value={form.localId}
                    onChange={(e) => setForm({ ...form, localId: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder="gw-paris.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Identite distante (optionnel)</Label>
                  <Input
                    value={form.remoteId}
                    onChange={(e) => setForm({ ...form, remoteId: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder="gw-lyon.example.com"
                  />
                </div>
              </div>
              <p className="text-xs text-admin-text-muted">
                Une cle pre-partagee est generee automatiquement — visible depuis la page du tunnel.
              </p>
            </div>
            <AdminModalFooter>
              <AdminButton type="button" variant="secondary" onClick={() => setCreating(false)}>
                Annuler
              </AdminButton>
              <AdminButton type="submit" disabled={submitting}>
                {submitting ? 'Creation...' : 'Creer le tunnel'}
              </AdminButton>
            </AdminModalFooter>
          </form>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
