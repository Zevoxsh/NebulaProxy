import { useState, useEffect } from 'react';
import { Globe, Shield, Power, Trash2, X } from 'lucide-react';
import { teamAPI, domainAPI } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

export default function TeamDomains({ team, refreshTeam, setError, setSuccess }) {
  const { user } = useAuthStore();
  const [domains, setDomains] = useState([]);
  const [showAssignDomain, setShowAssignDomain] = useState(false);
  const [availableDomains, setAvailableDomains] = useState([]);

  const canManageDomains = team.user_permissions?.can_manage_domains
    ?? (team.user_role === 'owner' || Boolean(team.members?.find(m => String(m.user_id) === String(user?.id))?.can_manage_domains));

  useEffect(() => {
    fetchDomains();
  }, [team.id]);

  const fetchDomains = async () => {
    try {
      const response = await teamAPI.getDomains(team.id);
      setDomains(response.data.domains);
    } catch (err) {
      console.error('Failed to fetch domains:', err);
    }
  };

  const handleShowAssignDomain = async () => {
    try {
      const response = await domainAPI.list();
      const personalDomains = response.data.domains.filter(d => !d.team_id || d.ownership_type === 'personal');
      setAvailableDomains(personalDomains);
      setShowAssignDomain(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load domains');
    }
  };

  const handleAssignDomain = async (domainId) => {
    try {
      await teamAPI.assignDomain(team.id, domainId);
      setSuccess('Domain assigned successfully');
      setShowAssignDomain(false);
      await fetchDomains();
      await refreshTeam();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign domain');
    }
  };

  const handleRemoveDomain = async (domainId) => {
    if (!confirm('Remove domain from team?')) return;

    try {
      await teamAPI.removeDomain(team.id, domainId);
      setSuccess('Domain removed successfully');
      await fetchDomains();
      await refreshTeam();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove domain');
    }
  };

  const handleToggleDomain = async (domainId) => {
    try {
      await domainAPI.toggle(domainId);
      await fetchDomains();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle domain');
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-normal text-white">Domains ({domains.length})</h3>
            <p className="text-xs text-white/40">
              {team.domain_count}/{team.domain_quota} quota used
            </p>
          </div>
          {(team.can_add_domain || canManageDomains) && (
            <button
              onClick={handleShowAssignDomain}
              className="btn-primary flex items-center gap-2 text-xs px-3 py-1.5"
            >
              <Globe className="w-3.5 h-3.5" strokeWidth={1.5} />
              Assign Domain
            </button>
          )}
        </div>

        <div className="space-y-2">
          {domains.length > 0 ? (
            domains.map(domain => (
              <div key={domain.id} className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all duration-300">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-normal text-white truncate">{domain.hostname}</h4>
                      {domain.ssl_enabled && domain.proxy_type === 'http' && (
                        <Shield className="w-3.5 h-3.5 text-[#34D399] flex-shrink-0" strokeWidth={1.5} />
                      )}
                    </div>
                    <p className="text-xs text-white/50 truncate mb-2">{domain.backend_url}{domain.backend_port ? `:${domain.backend_port}` : ''}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full ${domain.proxy_type === 'http' ? 'bg-[#9D4EDD]/10 text-[#C77DFF] border border-[#9D4EDD]/20' : domain.proxy_type === 'tcp' ? 'bg-[#06B6D4]/10 text-[#22D3EE] border border-[#06B6D4]/20' : 'bg-[#F59E0B]/10 text-[#FBBF24] border border-[#F59E0B]/20'}`}>
                        {domain.proxy_type.toUpperCase()}
                      </span>
                      <span className={domain.is_active ? 'text-[9px] px-2 py-0.5 bg-[#10B981]/10 text-[#34D399] border border-[#10B981]/20 rounded-full' : 'text-[9px] px-2 py-0.5 bg-white/[0.05] text-white/40 border border-white/[0.05] rounded-full'}>
                        {domain.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {domain.user_display_name && (
                        <span className="text-[10px] text-white/30">by {domain.user_display_name}</span>
                      )}
                    </div>
                  </div>

                  {canManageDomains && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggleDomain(domain.id)}
                        className="p-1.5 text-white/60 hover:text-[#FBBF24] hover:bg-[#F59E0B]/10 rounded-lg transition-all duration-300"
                        title={domain.is_active ? 'Disable' : 'Enable'}
                      >
                        <Power className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleRemoveDomain(domain.id)}
                        className="p-1.5 text-white/60 hover:text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all duration-300"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  )}
                </div>

                {domain.description && (
                  <p className="text-xs text-white/40 leading-relaxed">{domain.description}</p>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center mx-auto mb-3">
                <Globe className="w-7 h-7 text-[#C77DFF]" strokeWidth={1.5} />
              </div>
              <p className="text-white/40 font-light text-xs mb-3">No domains yet</p>
              {(team.can_add_domain || canManageDomains) && (
                <button
                  onClick={handleShowAssignDomain}
                  className="btn-primary flex items-center gap-2 text-xs px-4 py-2 mx-auto"
                >
                  <Globe className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Assign Domain
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Assign Domain Modal */}
      {showAssignDomain && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-lg w-full p-5 shadow-lg animate-scale-in max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-light text-white">Assign Domain</h2>
              <button onClick={() => setShowAssignDomain(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-2">
              {availableDomains.map(domain => (
                <div
                  key={domain.id}
                  onClick={() => handleAssignDomain(domain.id)}
                  className="p-3 bg-white/[0.02] rounded-lg hover:bg-white/[0.05] border border-white/[0.05] hover:border-[#9D4EDD]/30 transition-all duration-300 cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-normal text-white">{domain.hostname}</p>
                    {domain.ssl_enabled && <Shield className="w-3 h-3 text-[#34D399]" strokeWidth={1.5} />}
                  </div>
                  <p className="text-[10px] text-white/50 mb-1">{domain.backend_url}</p>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${domain.proxy_type === 'http' ? 'bg-[#9D4EDD]/10 text-[#C77DFF] border border-[#9D4EDD]/20' : domain.proxy_type === 'tcp' ? 'bg-[#06B6D4]/10 text-[#22D3EE] border border-[#06B6D4]/20' : 'bg-[#F59E0B]/10 text-[#FBBF24] border border-[#F59E0B]/20'}`}>
                    {domain.proxy_type.toUpperCase()}
                  </span>
                </div>
              ))}

              {availableDomains.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center mx-auto mb-3">
                    <Globe className="w-7 h-7 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <p className="text-white/40 font-light text-xs">No personal domains available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
