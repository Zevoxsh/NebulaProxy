import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Shield, Settings, ArrowRight, Plus, Activity, Folder, Cable } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useBrandingStore } from '../store/brandingStore';
import { domainAPI, domainGroupAPI } from '../api/client';
import StatsCard from '../components/ui/StatsCard';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const appName = useBrandingStore((s) => s.appName);
  const [domains, setDomains] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQuickStart, setShowQuickStart] = useState(false);

  useEffect(() => {
    fetchDomains();
    fetchGroups();
  }, []);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const response = await domainAPI.list();
      const fetchedDomains = response.data.domains;
      setDomains(fetchedDomains);
      if (fetchedDomains.length === 0) setShowQuickStart(true);
    } catch (err) {
      console.error('Failed to load domains:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await domainGroupAPI.list();
      setGroups(response.data.groups || []);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  };

  const activeDomains = domains.filter((d) => d.is_active).length;
  const sslDomains = domains.filter((d) => d.ssl_enabled).length;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-admin-text-muted text-sm">Loading your dashboard...</div>
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-admin-border bg-gradient-to-r from-admin-surface via-admin-surface-2 to-admin-bg-secondary p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] md:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-admin-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[#C77DFF] shadow-[0_0_12px_rgba(199,125,255,0.75)]" />
              NebulaProxy Control Center
            </div>
            <h1 className="text-3xl font-semibold text-admin-text mb-2">Dashboard</h1>
            <p className="text-admin-text-muted">System overview and key metrics for {appName}</p>
          </div>
          <div className="hidden md:flex items-center gap-2 rounded-xl border border-admin-border bg-white/5 px-3 py-2 text-xs text-admin-text-muted">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]" />
            Live panel
          </div>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatsCard icon={Globe} title="Domains" value={domains.length} subtitle={`${activeDomains} active`} variant="purple" delay="0.1s" />
          <StatsCard
            icon={Shield}
            title="SSL"
            value={sslDomains}
            subtitle="secured"
            badge={domains.length > 0 ? `${Math.round((sslDomains / domains.length) * 100)}%` : '0%'}
            variant="success"
            delay="0.2s"
          />
          <StatsCard icon={Folder} title="Groups" value={groups.length} subtitle="organized" variant="info" delay="0.3s" />
          <StatsCard
            icon={Settings}
            title="Account"
            value={user?.role}
            subtitle={user?.role === 'admin' ? 'Full access' : 'Standard'}
            badge={user?.role}
            variant="warning"
            delay="0.4s"
          />
        </div>

        {showQuickStart && domains.length === 0 && (
          <div className="mb-8 animate-fade-in" style={{ animationDelay: '0.4s' }}>
            <div className="card-standard p-5">
              <div className="mb-5">
                <h2 className="text-xl font-light text-admin-text tracking-tight mb-2">Get Started with {appName}</h2>
                <p className="text-sm text-admin-text-muted font-light">Set up your first proxy in 3 easy steps</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                {[
                  { step: 1, title: 'Add a Domain', text: 'Create your first domain and configure backend URL' },
                  { step: 2, title: 'Enable SSL', text: "Secure your proxy with automatic Let's Encrypt certificates" },
                  { step: 3, title: 'Monitor Status', text: 'Track health and get notifications for changes' },
                ].map((item) => (
                  <div key={item.step} className="card-standard">
                    <div className="w-12 h-12 rounded-lg bg-admin-surface2 border border-admin-border flex items-center justify-center mb-3">
                      <span className="text-lg font-medium text-admin-text">{item.step}</span>
                    </div>
                    <h3 className="text-sm font-medium text-admin-text mb-2">{item.title}</h3>
                    <p className="text-xs text-admin-text-muted leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button onClick={() => navigate('/domains')} className="btn-primary flex items-center gap-2">
                  <Plus className="w-5 h-5" strokeWidth={1.5} />
                  Add Your First Domain
                </button>
                <button onClick={() => navigate('/tunnels')} className="btn-secondary flex items-center gap-2">
                  <Cable className="w-5 h-5" strokeWidth={1.5} />
                  Open Tunnels
                </button>
                <button onClick={() => setShowQuickStart(false)} className="btn-secondary">
                  Skip Guide
                </button>
              </div>
            </div>
          </div>
        )}

        {domains.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Domains', hint: 'Manage proxies', icon: Globe, onClick: () => navigate('/domains') },
              { label: 'Groups', hint: 'Organize domains', icon: Folder, onClick: () => navigate('/domains') },
              { label: 'Tunnels', hint: 'Quick connect & bindings', icon: Cable, onClick: () => navigate('/tunnels') },
              { label: 'Monitoring', hint: 'Health status', icon: Activity, onClick: () => navigate('/domains') },
              { label: 'SSL', hint: 'Certificates', icon: Shield, onClick: () => navigate('/ssl-certificates') },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className="group card-standard text-left cursor-pointer active:scale-98 animate-fade-in"
                  style={{ animationDelay: `${0.5 + idx * 0.1}s` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 rounded-xl bg-admin-surface2 border border-admin-border flex items-center justify-center transition-all duration-500">
                      <Icon className="w-6 h-6 text-admin-text" strokeWidth={1.5} />
                    </div>
                    <ArrowRight className="w-5 h-5 text-admin-text-subtle group-hover:text-admin-text group-hover:translate-x-2 transition-all duration-500" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-sm font-medium text-admin-text mb-1">{item.label}</h3>
                  <p className="text-xs text-admin-text-muted font-light">{item.hint}</p>
                </button>
              );
            })}
          </div>
        )}

        {domains.length > 0 && (
          <div className="animate-fade-in" style={{ animationDelay: '0.6s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-light text-admin-text tracking-tight">Recent Domains</h3>
              <button onClick={() => navigate('/domains')} className="btn-secondary text-xs flex items-center gap-2">
                View all
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="card-standard overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="border-b border-admin-border">
                      <th className="text-left text-xs uppercase tracking-wider text-admin-text-muted font-medium px-4 py-3">Hostname</th>
                      <th className="text-left text-xs uppercase tracking-wider text-admin-text-muted font-medium px-4 py-3">Backend</th>
                      <th className="text-left text-xs uppercase tracking-wider text-admin-text-muted font-medium px-4 py-3">Status</th>
                      <th className="text-left text-xs uppercase tracking-wider text-admin-text-muted font-medium px-4 py-3">SSL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.slice(0, 5).map((domain) => (
                      <tr key={domain.id} className="border-b border-admin-border last:border-0 hover:bg-admin-surface2 transition-all duration-300">
                        <td className="px-4 py-3 text-xs text-admin-text font-normal">{domain.hostname}</td>
                        <td className="px-4 py-3 text-xs text-admin-text-muted font-mono font-light">{domain.backend_url}</td>
                        <td className="px-4 py-3">
                          <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                            <div className={`w-2 h-2 rounded-full ${domain.is_active ? 'bg-admin-success' : 'bg-admin-text-subtle'}`} />
                            {domain.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {domain.ssl_enabled ? (
                            <div className="w-8 h-8 rounded-lg bg-admin-success/10 flex items-center justify-center border border-admin-success/30">
                              <Shield className="w-4 h-4 text-admin-success" strokeWidth={1.5} />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-admin-surface2 flex items-center justify-center border border-admin-border">
                              <Shield className="w-4 h-4 text-admin-text-subtle" strokeWidth={1.5} />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
