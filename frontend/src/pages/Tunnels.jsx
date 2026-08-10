import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cable, ChevronRight, Cloud, Loader2, Plus, RefreshCw, Wifi, AlertCircle } from 'lucide-react';
import { tunnelsAPI } from '../api/client';

function TunnelStatus({ tunnel }) {
  const onlineAgents = tunnel.agents?.filter((agent) => agent.status === 'online').length || 0;
  const hasBindings = tunnel.bindings?.length || 0;

  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{tunnel.provider}</span>
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{onlineAgents} agent(s) en ligne</span>
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{hasBindings} port(s) publié(s)</span>
    </div>
  );
}

function getTunnelHostnamePreview(tunnel) {
  const publicSlug = tunnel.public_slug || tunnel.publicSlug || tunnel.id;
  const publicDomain = tunnel.public_domain || 'paxcia.net';
  return `tcp.${publicSlug}.${publicDomain}`;
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center border flex-shrink-0"
        style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
        <Icon className="w-5 h-5" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-xs text-white/50 font-light">{label}</p>
        <p className="text-xl font-light text-white">{value}</p>
        {sub && <p className="text-xs text-white/40">{sub}</p>}
      </div>
    </div>
  );
}

export default function Tunnels() {
  const navigate = useNavigate();
  const basePath = '/tunnels';

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
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">Tunnels</h1>
              <p className="text-sm text-white/50 font-light mt-1">Gère tes tunnels : installation de l'agent, publication des ports et accès partagé.</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={refresh} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2">
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Actualiser
              </button>
              <button onClick={createTunnel} className="btn-primary flex items-center gap-2 text-xs px-4 py-2">
                <Plus className="w-4 h-4" />
                Nouveau tunnel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard icon={Cloud} label="Tunnels" value={tunnels.length} sub="dans la liste" />
          <StatCard icon={Wifi} label="Agents en ligne" value={onlineCount} sub="connectés maintenant" />
          <StatCard icon={Cable} label="Ports publiés" value={tunnels.reduce((total, tunnel) => total + (tunnel.bindings?.length || 0), 0)} sub="règles de redirection" />
        </div>

        {error && (
          <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-[#F87171] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-xs text-[#F87171] font-light">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-10 text-center text-white/50">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#9D4EDD]" />
            <p className="mt-3 text-sm">Chargement des tunnels...</p>
          </div>
        ) : tunnels.length === 0 ? (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg" style={{ background: '#9D4EDD18', color: '#9D4EDD' }}>
                <Cloud className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-light text-white">Aucun tunnel pour le moment</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">
                Crée un tunnel puis ouvre-le pour configurer les ports, l'accès et l'installation de l'agent.
              </p>
              <div className="mt-6 flex justify-center">
                <button onClick={createTunnel} className="btn-primary flex items-center gap-2 text-xs px-4 py-2">
                  <Plus className="w-4 h-4" />
                  Créer un tunnel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {tunnels.map((tunnel) => (
              <button
                key={tunnel.id}
                type="button"
                onClick={() => openTunnel(tunnel.id)}
                className="group text-left bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] hover:border-[#9D4EDD]/30 rounded-xl transition-all duration-300"
              >
                <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate text-lg font-light text-white">{tunnel.name}</h3>
                      <span className={getOnlineAgentsCount(tunnel) > 0 ? 'badge-success' : 'badge-purple'}>
                        {getOnlineAgentsCount(tunnel) > 0 ? 'Agent connecté' : 'En attente'}
                      </span>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-white/50">
                      {tunnel.description || 'Aucune description.'}
                    </p>
                    <TunnelStatus tunnel={tunnel} />
                  </div>

                  <div className="flex w-full items-center justify-between gap-4 md:w-auto">
                    <div className="hidden text-right md:block">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/40">Adresse publique</div>
                      <div className="mt-1 max-w-[280px] truncate text-sm font-medium text-white">{getTunnelHostnamePreview(tunnel)}</div>
                    </div>
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-white/50 transition-all group-hover:bg-white/[0.06] group-hover:text-white">
                      <ChevronRight className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
