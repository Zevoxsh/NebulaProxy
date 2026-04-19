import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Cable, ChevronRight, Cloud, Loader2, Plus, RefreshCw, Server, Wifi } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
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
    <div className="space-y-6 max-w-[1600px] pb-10">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(251,191,36,0.16),transparent_25%)]" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <Cloud className="h-3.5 w-3.5 text-cyan-300" />
              Tunnel management
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">Tunnels</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 md:text-base">
                {mode === 'admin'
                  ? 'Vue admin des tunnels, agents et bindings.'
                  : 'Liste simple de tous tes tunnels. Clique sur un tunnel pour ouvrir sa configuration.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-white/45">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{tunnels.length} tunnel(s)</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{onlineCount} agent(s) online</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <AdminButton variant="secondary" onClick={refresh} className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06]">
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </AdminButton>
            <AdminButton onClick={createTunnel} className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500">
              <Plus className="mr-2 h-4 w-4" />
              New tunnel
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

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-white/70">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
            <span className="text-sm">Loading tunnels...</span>
          </div>
        </div>
      ) : tunnels.length === 0 ? (
        <AdminCard className="rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
          <AdminCardContent className="p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/70">
                <Cloud className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-white">No tunnel yet</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">
                Create a tunnel, then open it to configure ports, access, and enrollment.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <AdminButton onClick={createTunnel} className="bg-white text-slate-950 hover:bg-white/90">
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
              <AdminCard className="rounded-[1.5rem] border-white/10 bg-slate-950/70 shadow-[0_20px_50px_rgba(0,0,0,0.18)] transition-all duration-200 group-hover:border-cyan-400/30 group-hover:bg-slate-950/85">
                <AdminCardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate text-lg font-semibold text-white">{tunnel.name}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tunnel.status === 'online' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-white/55'}`}>
                        {tunnel.status || 'unknown'}
                      </span>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-white/50">
                      {tunnel.description || 'No description provided.'}
                    </p>
                    <TunnelStatus tunnel={tunnel} />
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="hidden text-right md:block">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/35">Domain</div>
                      <div className="mt-1 max-w-[280px] truncate text-sm font-medium text-white/80">{tunnel.public_domain}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-white/60 transition-all group-hover:bg-white/[0.06]">
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
