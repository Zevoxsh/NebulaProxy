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
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{onlineAgents} online agent(s)</span>
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{hasBindings} binding(s)</span>
    </div>
  );
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
              ? 'Vue admin des tunnels, agents et bindings.'
              : 'Liste de tes tunnels. Ouvre-en un pour configurer les ports, l’accès et l’installation.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <AdminButton variant="secondary" onClick={refresh}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </AdminButton>
          <AdminButton onClick={createTunnel}>
            <Plus className="mr-2 h-4 w-4" />
            New tunnel
          </AdminButton>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <AdminStatCard title="Total tunnels" value={tunnels.length} subtitle="visible in the list" icon={Cloud} />
        <AdminStatCard title="Online agents" value={onlineCount} subtitle="currently connected" icon={Wifi} />
        <AdminStatCard title="Bindings" value={tunnels.reduce((total, tunnel) => total + (tunnel.bindings?.length || 0), 0)} subtitle="port forwarding rules" icon={Cable} />
      </div>

      {error && (
        <AdminAlert variant="destructive">
          <AdminAlertTitle>Error</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {loading ? (
        <AdminCard>
          <AdminCardContent className="p-10 text-center text-admin-text-muted">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-admin-primary" />
            <p className="mt-3 text-sm">Loading tunnels...</p>
          </AdminCardContent>
        </AdminCard>
      ) : tunnels.length === 0 ? (
        <AdminCard>
          <AdminCardContent className="p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-admin-primary/10 text-admin-primary">
                <Cloud className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-admin-text">No tunnel yet</h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">
                Create a tunnel, then open it to configure ports, access, and enrollment.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <AdminButton onClick={createTunnel}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add tunnel
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
                      <AdminBadge variant={tunnel.status === 'online' ? 'success' : 'secondary'}>
                        {tunnel.status || 'unknown'}
                      </AdminBadge>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-admin-text-muted">
                      {tunnel.description || 'No description provided.'}
                    </p>
                    <TunnelStatus tunnel={tunnel} />
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="hidden text-right md:block">
                      <div className="text-xs uppercase tracking-[0.18em] text-admin-text-muted">Domain</div>
                      <div className="mt-1 max-w-[280px] truncate text-sm font-medium text-admin-text">{tunnel.public_domain}</div>
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
