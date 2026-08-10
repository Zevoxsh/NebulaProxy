import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Lock, Plus, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { wireguardAPI } from '../../api/client';
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

const emptyForm = { name: '', mode: 'server', address: '', listenPort: '', mtu: '', dns: '' };

export default function AdminWireGuardList() {
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
      const response = await wireguardAPI.getAll();
      setTunnels(response.data.tunnels || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger les tunnels WireGuard');
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
  const peerCount = tunnels.reduce((total, t) => total + (t.peer_count || 0), 0);

  const openCreate = () => {
    setForm(emptyForm);
    setFormError('');
    setCreating(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        mode: form.mode,
        address: form.address.trim()
      };
      if (form.listenPort) payload.listenPort = Number.parseInt(form.listenPort, 10);
      if (form.mtu) payload.mtu = Number.parseInt(form.mtu, 10);
      if (form.dns) payload.dns = form.dns.trim();

      const response = await wireguardAPI.create(payload);
      setCreating(false);
      navigate(`/admin/wireguard/${response.data.tunnel.id}`);
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
          <h1 className="mb-2 text-3xl font-semibold text-admin-text md:text-4xl">WireGuard</h1>
          <p className="text-sm leading-6 text-admin-text-muted md:text-base">
            Tunnels VPN WireGuard — client ou serveur, pour la connectivite inter-sites.
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
        <AdminStatCard title="Tunnels" value={tunnels.length} subtitle="configures" icon={Lock} />
        <AdminStatCard title="Actifs" value={runningCount} subtitle="interfaces up" icon={Wifi} />
        <AdminStatCard title="Peers" value={peerCount} subtitle="au total" icon={ChevronRight} />
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
                <Lock className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-admin-text">Aucun tunnel WireGuard</h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">
                Cree un tunnel pour commencer — client ou serveur, avec un ou plusieurs peers.
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
              onClick={() => navigate(`/admin/wireguard/${tunnel.id}`)}
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
                      <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.interface_name}</span>
                      <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.address}</span>
                      <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1">{tunnel.peer_count || 0} peer(s)</span>
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
            <AdminModalTitle>Nouveau tunnel WireGuard</AdminModalTitle>
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
                  <option value="server">Serveur (accepte les connexions entrantes)</option>
                  <option value="client">Client (se connecte a un serveur distant)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Adresse du tunnel (CIDR)</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                  placeholder="10.10.0.1/24"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Port d'ecoute</Label>
                  <Input
                    type="number"
                    value={form.listenPort}
                    onChange={(e) => setForm({ ...form, listenPort: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder="51820"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">MTU (optionnel)</Label>
                  <Input
                    type="number"
                    value={form.mtu}
                    onChange={(e) => setForm({ ...form, mtu: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder="1420"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">DNS (optionnel)</Label>
                <Input
                  value={form.dns}
                  onChange={(e) => setForm({ ...form, dns: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  placeholder="1.1.1.1"
                />
              </div>
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
