import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Shield, Settings, ArrowRight, Activity, Folder, Cable, CheckCircle2, Circle, ChevronRight, X } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useBrandingStore } from '../store/brandingStore';
import { domainAPI, domainGroupAPI } from '../api/client';
import StatsCard from '../components/ui/StatsCard';

// ── Onboarding checklist ──────────────────────────────────────────────────────
function OnboardingChecklist({ domains, groups, sslDomains, onDismiss }) {
  const navigate = useNavigate();

  const steps = [
    {
      id:    'domain',
      title: 'Create your first domain',
      desc:  'Set up a reverse proxy — point a hostname to your backend server.',
      done:  domains.length > 0,
      cta:   'Add domain',
      action: () => navigate('/domains'),
    },
    {
      id:    'ssl',
      title: 'Enable SSL on a domain',
      desc:  "Secure your proxy with a free Let's Encrypt certificate in one click.",
      done:  sslDomains > 0,
      cta:   'Manage domains',
      action: () => navigate('/domains'),
    },
    {
      id:    'group',
      title: 'Organise domains into groups',
      desc:  'Group related domains together for easier management and bulk actions.',
      done:  groups.length > 0,
      cta:   'Create a group',
      action: () => navigate('/domains'),
    },
    {
      id:    'notifications',
      title: 'Configure alert notifications',
      desc:  'Get notified by email, webhook, or Discord when a domain goes down.',
      done:  false,
      cta:   'Notification settings',
      action: () => navigate('/notification-settings'),
    },
    {
      id:    'monitoring',
      title: 'Explore health monitoring',
      desc:  'Check live uptime, response times, and SSL certificate status.',
      done:  false,
      cta:   'View monitoring',
      action: () => navigate('/domains'),
    },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const progress = Math.round((completedCount / steps.length) * 100);
  const allDone = completedCount === steps.length;

  return (
    <div className="mb-8 bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5 animate-fade-in" style={{ animationDelay: '0.4s' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-medium text-white">
              {allDone ? '🎉 Setup complete!' : 'Getting started'}
            </h2>
            <span className="text-xs text-white/40">
              {completedCount}/{steps.length} done
            </span>
          </div>
          <p className="text-xs text-white/50">
            {allDone
              ? 'Your proxy is fully configured. You can dismiss this guide.'
              : 'Follow these steps to get the most out of your proxy.'}
          </p>
          <div className="mt-3 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#9D4EDD] transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="ml-4 text-white/40 hover:text-white transition-colors"
          title="Dismiss guide"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
              step.done
                ? 'bg-[#10B981]/5 border-[#10B981]/15'
                : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.14]'
            }`}
          >
            <div className="flex-shrink-0">
              {step.done
                ? <CheckCircle2 className="w-4.5 h-4.5 text-[#10B981]" />
                : <Circle className="w-4.5 h-4.5 text-white/40" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${step.done ? 'text-white/40 line-through' : 'text-white'}`}>
                {step.title}
              </p>
              {!step.done && (
                <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">{step.desc}</p>
              )}
            </div>
            {!step.done && (
              <button
                onClick={step.action}
                className="flex-shrink-0 flex items-center gap-1 text-[11px] text-[#C77DFF] hover:text-white transition-colors"
              >
                {step.cta}
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-white/40 mt-3 text-right">
        <button onClick={onDismiss} className="hover:text-white transition-colors underline underline-offset-2">
          Dismiss guide
        </button>
      </p>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const appName = useBrandingStore((s) => s.appName);
  const [domains, setDomains] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const dismissKey = `nebula_onboarding_${user?.id}_dismissed`;
  const [showChecklist, setShowChecklist] = useState(
    () => localStorage.getItem(dismissKey) !== '1'
  );

  const handleDismiss = useCallback(() => {
    localStorage.setItem(dismissKey, '1');
    setShowChecklist(false);
  }, [dismissKey]);

  useEffect(() => {
    fetchDomains();
    fetchGroups();
  }, []);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const response = await domainAPI.list();
      setDomains(response.data.domains);
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
        <div className="text-white/50 text-sm">Loading your dashboard...</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-[#C77DFF] shadow-[0_0_12px_rgba(199,125,255,0.75)]" />
                NebulaProxy Control Center
              </div>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">Dashboard</h1>
              <p className="text-sm text-white/50 font-light mt-1">System overview and key metrics for {appName}</p>
            </div>
            <div className="hidden md:flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/50">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]" />
              Live panel
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
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

        {showChecklist && (
          <OnboardingChecklist
            domains={domains}
            groups={groups}
            sslDomains={sslDomains}
            onDismiss={handleDismiss}
          />
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
                  className="group bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] hover:border-[#9D4EDD]/30 rounded-xl p-4 text-left cursor-pointer active:scale-98 animate-fade-in transition-all duration-300"
                  style={{ animationDelay: `${0.5 + idx * 0.1}s` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center transition-all duration-500">
                      <Icon className="w-6 h-6 text-white" strokeWidth={1.5} />
                    </div>
                    <ArrowRight className="w-5 h-5 text-white/30 group-hover:text-white group-hover:translate-x-2 transition-all duration-500" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-sm font-medium text-white mb-1">{item.label}</h3>
                  <p className="text-xs text-white/50 font-light">{item.hint}</p>
                </button>
              );
            })}
          </div>
        )}

        {domains.length > 0 && (
          <div className="animate-fade-in" style={{ animationDelay: '0.6s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-light text-white tracking-tight">Recent Domains</h3>
              <button onClick={() => navigate('/domains')} className="btn-secondary text-xs flex items-center gap-2">
                View all
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="text-left text-xs uppercase tracking-wider text-white/50 font-medium px-4 py-3">Hostname</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/50 font-medium px-4 py-3">Backend</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/50 font-medium px-4 py-3">Status</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/50 font-medium px-4 py-3">SSL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.slice(0, 5).map((domain) => (
                      <tr key={domain.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-300">
                        <td className="px-4 py-3 text-xs text-white font-normal">{domain.hostname}</td>
                        <td className="px-4 py-3 text-xs text-white/50 font-mono font-light">{domain.backend_url}</td>
                        <td className="px-4 py-3">
                          <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                            <div className={`w-2 h-2 rounded-full ${domain.is_active ? 'bg-[#10B981]' : 'bg-white/30'}`} />
                            {domain.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {domain.ssl_enabled ? (
                            <div className="w-8 h-8 rounded-lg bg-[#10B981]/10 flex items-center justify-center border border-[#10B981]/30">
                              <Shield className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center border border-white/[0.08]">
                              <Shield className="w-4 h-4 text-white/30" strokeWidth={1.5} />
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
