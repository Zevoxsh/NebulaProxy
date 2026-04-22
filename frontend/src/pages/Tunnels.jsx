import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cable, ChevronRight, Cloud, Loader2, Plus, RefreshCw, Wifi } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle,
  AdminBadge,
  AdminStatCard
} from '@/components/admin';

function TunnelStatus({ tunnel }) {
  const onlineAgents = tunnel.agents?.filter((agent) => agent.status === 'online').length || 0;
  const hasBindings = tunnel.bindings?.length || 0;

  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{tunnel.provider}</span>
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{onlineAgents} agent(s) en ligne</span>
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{hasBindings} port(s) publie(s)</span>
    </div>
  );
}

function getTunnelHostnamePreview(tunnel) {
  const publicSlug = tunnel.public_slug || tunnel.publicSlug || tunnel.id;
  const publicDomain = tunnel.public_domain || 'tunnel.nebula-app.dev';
  return `tcp.${publicSlug}.${publicDomain}`;
}

export default function Tunnels({ mode = 'client' }) {
  const navigate = useNavigate();
  const basePath = mode === 'admin' ? '/admin/tunnels' : '/tunnels';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tunnels, setTunnels] = useState([]);

  const onlineCount = useMemo(
    () => tunnels.reduce((total, tunnel) => total + (tunnel.agents?.filter((agent) => agent.status === 'online').length || 0), 0),
    [tunnels]
  );

  const getOnlineAgentsCount = (tunnel) => tunnel.agents?.filter((agent) => agent.status === 'online').length || 0;

  const refresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const response = await tunnelsAPI.getAll();
      setTunnels(response.data.tunnels || []);
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
    const interval = window.setInterval(() => {
      refresh();
    }, 6000);

    return () => window.clearInterval(interval);
  }, []);

  const openTunnel = (tunnelId) => {
    navigate(`${basePath}/${tunnelId}`);
  };

  const createTunnel = () => {
    navigate(`${basePath}/new`);
  };

  return (
    <div data-admin-theme className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-semibold text-admin-text">Tunnels</h1>
          <p className="text-admin-text-muted">
            {mode === 'admin'
              ? 'Vue administrateur des tunnels, agents et ports publies.'
              : 'Gere tes tunnels: installation de l agent, publication des ports et acces partage.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <AdminButton variant="secondary" onClick={refresh}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser
          </AdminButton>
          <AdminButton onClick={createTunnel}>
            <Plus className="mr-2 h-4 w-4" />
            Nouveau tunnel
          </AdminButton>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <AdminStatCard title="Tunnels" value={tunnels.length} subtitle="dans la liste" icon={Cloud} />
        <AdminStatCard title="Agents en ligne" value={onlineCount} subtitle="connectes maintenant" icon={Wifi} />
        <AdminStatCard title="Ports publies" value={tunnels.reduce((total, tunnel) => total + (tunnel.bindings?.length || 0), 0)} subtitle="regles de redirection" icon={Cable} />
      </div>

      {error && (
        <AdminAlert variant="destructive">
          <AdminAlertTitle>Erreur</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {loading ? (
        <AdminCard>
          <AdminCardContent className="p-10 text-center text-admin-text-muted">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-admin-primary" />
            <p className="mt-3 text-sm">Chargement des tunnels...</p>
          </AdminCardContent>
        </AdminCard>
      ) : tunnels.length === 0 ? (
        <AdminCard>
          <AdminCardContent className="p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-admin-primary/10 text-admin-primary">
                <Cloud className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-admin-text">Aucun tunnel pour le moment</h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">
                Cree un tunnel puis ouvre-le pour configurer les ports, l acces et l installation de l agent.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <AdminButton onClick={createTunnel}>
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
              onClick={() => openTunnel(tunnel.id)}
              className="group text-left"
            >
              <AdminCard className="transition-all duration-200 group-hover:border-admin-primary/30 group-hover:shadow-md">
                <AdminCardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate text-lg font-semibold text-admin-text">{tunnel.name}</h3>
                      <AdminBadge variant={getOnlineAgentsCount(tunnel) > 0 ? 'success' : 'secondary'}>
                        {getOnlineAgentsCount(tunnel) > 0 ? 'Agent connecte' : 'En attente'}
                      </AdminBadge>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-admin-text-muted">
                      {tunnel.description || 'Aucune description.'}
                    </p>
                    <TunnelStatus tunnel={tunnel} />
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="hidden text-right md:block">
                      <div className="text-xs uppercase tracking-[0.18em] text-admin-text-muted">Adresse publique</div>
                      <div className="mt-1 max-w-[280px] truncate text-sm font-medium text-admin-text">{getTunnelHostnamePreview(tunnel)}</div>
                    </div>
                    <div className="rounded-lg border border-admin-border bg-admin-surface2 p-3 text-admin-text-muted transition-all group-hover:bg-admin-surface">
                      <ChevronRight className="h-5 w-5" />
                    </div>
                  </div>
                </AdminCardContent>
              </AdminCard>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
