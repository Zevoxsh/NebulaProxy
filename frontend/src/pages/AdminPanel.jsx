import { useState, useEffect } from 'react';
import { Users, BarChart3, Globe, Shield, Edit, Power, X, AlertCircle, UserCheck, Trash2, Link as LinkIcon, Settings as SettingsIcon, Database } from 'lucide-react';
import { adminAPI } from '../api/client';
import StatsCard from '../components/ui/StatsCard';
import UpdatesPanel from './UpdatesPanel';
import DatabaseBackup from '../components/admin/DatabaseBackup';
import { Switch } from '@/components/ui/switch';

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [domains, setDomains] = useState([]);
  const [teams, setTeams] = useState([]);
  const [redirections, setRedirections] = useState([]);
  const [stats, setStats] = useState(null);
  const [configSections, setConfigSections] = useState([]);
  const [configForm, setConfigForm] = useState({});
  const [configSubmitting, setConfigSubmitting] = useState(false);
  const [configSuccess, setConfigSuccess] = useState('');
  const [configErrors, setConfigErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingDomain, setEditingDomain] = useState(null);
  const [editingRedirection, setEditingRedirection] = useState(null);
  const [quotaForm, setQuotaForm] = useState({ maxDomains: 0, maxRedirections: 10 });
  const [teamQuotaForm, setTeamQuotaForm] = useState({ maxDomains: 0 });
  const [redirectionForm, setRedirectionForm] = useState({
    shortCode: '',
    targetUrl: '',
    description: '',
    isActive: true
  });
  const [domainForm, setDomainForm] = useState({
    hostname: '',
    backendUrl: '',
    backendPort: '',
    externalPort: '',
    description: '',
    proxyType: 'http',
    sslEnabled: false,
    challengeType: 'http-01',
    isActive: true,
    ownerId: '',
    teamId: ''
  });
  const [domainUsers, setDomainUsers] = useState([]);
  const [domainTeams, setDomainTeams] = useState([]);
  const [domainSubmitting, setDomainSubmitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      if (activeTab === 'users') {
        const response = await adminAPI.listUsers();
        setUsers(response.data.users);
      } else if (activeTab === 'domains') {
        const [domainsResponse, usersResponse, teamsResponse] = await Promise.all([
          adminAPI.getAllDomains(),
          adminAPI.listUsers(),
          adminAPI.getAllTeams()
        ]);
        setDomains(domainsResponse.data.domains);
        setDomainUsers(usersResponse.data.users || []);
        setDomainTeams(teamsResponse.data.teams || []);
      } else if (activeTab === 'teams') {
        const response = await adminAPI.getAllTeams();
        setTeams(response.data.teams);
      } else if (activeTab === 'redirections') {
        const response = await adminAPI.getAllRedirections();
        setRedirections(response.data.redirections);
      } else if (activeTab === 'stats') {
        const response = await adminAPI.getStats();
        setStats(response.data.stats);
      } else if (activeTab === 'config') {
        const response = await adminAPI.getConfig();
        setConfigSections(response.data.sections || []);
        const nextForm = {};
        (response.data.sections || []).forEach(section => {
          section.variables.forEach(variable => {
            nextForm[variable.key] = variable.value ?? '';
          });
        });
        setConfigForm(nextForm);
        setConfigSuccess('');
        setConfigErrors([]);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const openEditQuotas = (user) => {
    setEditingUser(user);
    setQuotaForm({
      maxDomains: user.max_domains,
      maxRedirections: user.max_redirections || 10
    });
  };

  const handleUpdateConfig = async (e) => {
    e.preventDefault();
    try {
      setConfigSubmitting(true);
      setError('');
      setConfigSuccess('');
      setConfigErrors([]);

      const validation = await adminAPI.validateConfig(configForm);
      if (!validation.data.valid) {
        setConfigErrors(validation.data.errors || []);
        return;
      }

      const response = await adminAPI.updateConfig(configForm);
      if (!response.data.success) {
        setConfigErrors(response.data.errors || ['Failed to save configuration']);
        return;
      }
      setConfigSuccess('Configuration updated. Restart required.');
    } catch (err) {
      const errors = err.response?.data?.errors || [];
      if (errors.length > 0) {
        setConfigErrors(errors);
      } else {
        setError(err.response?.data?.message || 'Failed to update configuration');
      }
    } finally {
      setConfigSubmitting(false);
    }
  };

  const handleValidateConfig = async () => {
    try {
      setError('');
      setConfigSuccess('');
      setConfigErrors([]);
      const validation = await adminAPI.validateConfig(configForm);
      if (!validation.data.valid) {
        setConfigErrors(validation.data.errors || []);
        return;
      }
      setConfigSuccess('Configuration is valid.');
    } catch (err) {
      const errors = err.response?.data?.errors || [];
      if (errors.length > 0) {
        setConfigErrors(errors);
      } else {
        setError(err.response?.data?.message || 'Failed to validate configuration');
      }
    }
  };

  const closeEditQuotas = () => {
    setEditingUser(null);
    setError('');
  };

  const openEditTeamQuota = (team) => {
    setEditingTeam(team);
    setTeamQuotaForm({
      maxDomains: team.domain_quota ?? team.max_domains ?? 0
    });
  };

  const closeEditTeamQuota = () => {
    setEditingTeam(null);
    setError('');
  };

  const handleUpdateQuotas = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      await adminAPI.updateQuotas(editingUser.id, quotaForm);

      // Rafraîchir les données du backend pour s'assurer d'avoir les dernières valeurs
      await fetchData();

      closeEditQuotas();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update quotas');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateTeamQuota = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await adminAPI.updateTeamQuota(editingTeam.id, {
        maxDomains: teamQuotaForm.maxDomains
      });
      await fetchData();
      closeEditTeamQuota();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update team quota');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleUser = async (user) => {
    try {
      await adminAPI.toggleUser(user.id);
      setUsers(users.map(u =>
        u.id === user.id ? { ...u, is_active: !u.is_active } : u
      ));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle user');
    }
  };

  const handleDeleteUser = async (user) => {
    const confirmed = window.confirm(`Delete user "${user.username}"? This will remove all domains.`);
    if (!confirmed) {
      return;
    }

    try {
      await adminAPI.deleteUser(user.id);
      setUsers(prev => prev.filter(u => u.id !== user.id));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete user');
    }
  };

  const openEditDomain = (domain) => {
    let backendUrl = domain.backend_url || '';
    if (domain.proxy_type === 'tcp' || domain.proxy_type === 'udp') {
      backendUrl = backendUrl.replace(/^(tcp|udp):\/\//, '');
    }

    const isWildcard = domain.hostname?.startsWith('*.');
    const challengeType = isWildcard && domain.ssl_enabled ? 'dns-01' : (domain.acme_challenge_type || 'http-01');

    setEditingDomain(domain);
    setDomainForm({
      hostname: domain.hostname || '',
      backendUrl,
      backendPort: domain.backend_port || '',
      externalPort: domain.external_port ? String(domain.external_port) : '',
      description: domain.description || '',
      proxyType: domain.proxy_type || 'http',
      sslEnabled: !!domain.ssl_enabled,
      challengeType: challengeType,
      isActive: !!domain.is_active,
      ownerId: domain.user_id || '',
      teamId: domain.team_id ?? ''
    });
  };

  const closeEditDomain = () => {
    if (domainSubmitting) return;
    setEditingDomain(null);
    setError('');
  };

  const handleDomainFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setDomainForm(prev => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      };
      if (next.hostname.startsWith('*.') && next.sslEnabled) {
        next.challengeType = 'dns-01';
      }
      return next;
    });
  };

  const handleUpdateDomain = async (e) => {
    e.preventDefault();
    try {
      setDomainSubmitting(true);
      setError('');

      let challengeType = domainForm.challengeType;
      if (domainForm.hostname.startsWith('*.') && domainForm.sslEnabled) {
        challengeType = 'dns-01';
      }

      const ownerIdValue = Number(domainForm.ownerId);
      const hasValidOwner = Number.isInteger(ownerIdValue) && ownerIdValue > 0;
      const payload = {
        hostname: domainForm.hostname.trim(),
        backendUrl: domainForm.backendUrl.trim(),
        backendPort: domainForm.backendPort ? String(domainForm.backendPort).trim() : '',
        description: domainForm.description.trim(),
        proxyType: domainForm.proxyType,
        sslEnabled: domainForm.sslEnabled,
        challengeType: challengeType,
        isActive: domainForm.isActive,
        ...(hasValidOwner ? { ownerId: ownerIdValue } : {}),
        teamId: domainForm.teamId === '' ? null : Number(domainForm.teamId)
      };

      if (!payload.backendPort) {
        delete payload.backendPort;
      }
      if (!payload.description) {
        delete payload.description;
      }

      if (domainForm.proxyType === 'tcp' || domainForm.proxyType === 'udp') {
        if (payload.backendUrl && !payload.backendUrl.includes('://')) {
          payload.backendUrl = `${domainForm.proxyType}://${payload.backendUrl}`;
        }
        if (domainForm.externalPort === '') {
          payload.externalPort = null;
        } else {
          payload.externalPort = Number(domainForm.externalPort);
        }
      } else {
        delete payload.externalPort;
      }

      await adminAPI.updateDomain(editingDomain.id, payload);
      await fetchData();
      closeEditDomain();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update domain');
    } finally {
      setDomainSubmitting(false);
    }
  };

  const openEditRedirection = (redirection) => {
    setEditingRedirection(redirection);
    setRedirectionForm({
      shortCode: redirection.short_code || '',
      targetUrl: redirection.target_url || '',
      description: redirection.description || '',
      isActive: !!redirection.is_active
    });
  };

  const closeEditRedirection = () => {
    if (submitting) return;
    setEditingRedirection(null);
    setError('');
  };

  const handleRedirectionFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setRedirectionForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleUpdateRedirection = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      const payload = {
        targetUrl: redirectionForm.targetUrl.trim(),
        description: redirectionForm.description.trim() || undefined,
        isActive: redirectionForm.isActive
      };

      await adminAPI.updateRedirection(editingRedirection.id, payload);
      await fetchData();
      closeEditRedirection();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update redirection');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRedirection = async (redirection) => {
    try {
      await adminAPI.toggleRedirection(redirection.id);
      setRedirections(redirections.map(r =>
        r.id === redirection.id ? { ...r, is_active: !r.is_active } : r
      ));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle redirection');
    }
  };

  const handleDeleteRedirection = async (redirection) => {
    const confirmed = window.confirm(`Delete redirection "${redirection.short_code}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await adminAPI.deleteRedirection(redirection.id);
      setRedirections(prev => prev.filter(r => r.id !== redirection.id));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete redirection');
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          {/* Header */}
          <div className="animate-fade-in">
            <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Admin Panel</h1>
            <p className="text-xs text-white/50 font-light tracking-wide">Manage users and system</p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2.5 mt-4 animate-fade-in overflow-x-auto" style={{ animationDelay: '0.1s' }}>
            <button
              onClick={() => setActiveTab('users')}
              className={activeTab === 'users' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <Users className="w-4 h-4" strokeWidth={1.5} />
              Users
            </button>
            <button
              onClick={() => setActiveTab('domains')}
              className={activeTab === 'domains' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <Globe className="w-4 h-4" strokeWidth={1.5} />
              Domains
            </button>
            <button
              onClick={() => setActiveTab('redirections')}
              className={activeTab === 'redirections' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <LinkIcon className="w-4 h-4" strokeWidth={1.5} />
              Redirections
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              className={activeTab === 'teams' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <UserCheck className="w-4 h-4" strokeWidth={1.5} />
              Teams
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={activeTab === 'stats' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <BarChart3 className="w-4 h-4" strokeWidth={1.5} />
              Stats
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={activeTab === 'config' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <SettingsIcon className="w-4 h-4" strokeWidth={1.5} />
              Config
            </button>
            <button
              onClick={() => setActiveTab('backups')}
              className={activeTab === 'backups' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <Database className="w-4 h-4" strokeWidth={1.5} />
              Backups
            </button>
            <button
              onClick={() => setActiveTab('updates')}
              className={activeTab === 'updates' ? 'btn-primary flex items-center gap-2 text-xs px-4 py-2' : 'btn-secondary flex items-center gap-2 text-xs px-4 py-2'}
            >
              <Power className="w-4 h-4" strokeWidth={1.5} />
              Updates
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* Error Message */}
        {error && (
          <div className="alert-error mb-6 animate-fade-in">
            <div className="w-8 h-8 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-[#F87171]" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-[#F87171] mb-0.5">Error</p>
              <p className="text-xs text-white/70 font-light leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Users Table */}
        {activeTab === 'users' && (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">
                    User
                  </th>
                  <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">
                    Role
                  </th>
                  <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">
                    Domains
                  </th>
                  <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">
                    Quota
                  </th>
                  <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-500">
                    <td className="px-5 py-3">
                      <div>
                        <p className="text-xs font-normal text-white">{user.username}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={user.role === 'admin' ? 'badge-error' : 'badge-purple'}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-white font-normal">
                      {user.domain_count || 0}
                    </td>
                    <td className="px-5 py-3 text-xs text-white/60 font-light">
                      {user.max_domains} domains / {user.max_redirections || 10} redirections
                    </td>
                    <td className="px-5 py-3">
                      <span className={user.is_active ? 'badge-success' : 'badge-purple'}>
                        <div className={`w-2 h-2 rounded-full ${user.is_active ? 'bg-[#34D399]' : 'bg-white/40'}`} />
                        {user.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditQuotas(user)}
                          className="p-2 text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded-lg transition-all duration-500 active:scale-98"
                          title="Edit Quotas"
                        >
                          <Edit className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => handleToggleUser(user)}
                          className="p-2 text-[#FBBF24] hover:bg-[#F59E0B]/10 rounded-lg transition-all duration-500 active:scale-98"
                          title="Toggle Status"
                        >
                          <Power className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="p-2 text-[#F87171] hover:bg-[#F87171]/10 rounded-lg transition-all duration-500 active:scale-98"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {users.length === 0 && !loading && (
              <div className="p-12 text-center">
                <p className="text-white/40 font-light tracking-wide text-xs">No users found</p>
              </div>
            )}
          </div>
        )}

        {/* Config */}
        {activeTab === 'config' && (
          <div className="space-y-4">
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                  <SettingsIcon className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-base font-light text-white">Configuration</h2>
                  <p className="text-xs text-white/50 font-light">Editing requires a backend restart to apply</p>
                </div>
              </div>

              {configSuccess && (
                <div className="mb-4 bg-[#10B981]/10 backdrop-blur-xl border border-[#10B981]/20 rounded-xl p-3">
                  <p className="text-xs text-[#34D399]">{configSuccess}</p>
                </div>
              )}

              {configErrors.length > 0 && (
                <div className="mb-4 bg-[#EF4444]/10 backdrop-blur-xl border border-[#EF4444]/20 rounded-xl p-3">
                  <p className="text-xs text-[#F87171] mb-1">Configuration errors</p>
                  <ul className="text-xs text-white/70 list-disc list-inside space-y-1">
                    {configErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <form onSubmit={handleUpdateConfig} className="space-y-4">
                {configSections.map((section, sectionIndex) => (
                  <div key={section.name} className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-4">
                    <h3 className="text-xs font-medium text-white/70 mb-3 uppercase tracking-[0.2em]">
                      {section.name}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {section.variables.map((variable) => {
                        const key = variable.key;
                        const value = configForm[key] ?? '';
                        const isSecret = /PASSWORD|SECRET|TOKEN/.test(key);
                        const fieldConfig = {
                          AUTH_MODE: { type: 'select', options: ['ldap', 'local'] },
                          NODE_ENV: { type: 'select', options: ['production', 'development'] },
                          PROXY_ENABLED: { type: 'select', options: ['true', 'false'] },
                          FRONTEND_BUILD_ON_START: { type: 'select', options: ['true', 'false'] },
                          LDAP_REQUIRE_GROUP: { type: 'select', options: ['true', 'false'] },
                          SMTP_SECURE: { type: 'select', options: ['true', 'false'] },
                          SMTP_TLS_REJECT_UNAUTHORIZED: { type: 'select', options: ['true', 'false'] },
                          CSRF_ENABLED: { type: 'select', options: ['true', 'false'] },
                          DNS_REBINDING_PROTECTION: { type: 'select', options: ['true', 'false'] },
                          HEALTHCHECK_SKIP_TCP: { type: 'select', options: ['true', 'false'] },
                          HEALTHCHECK_SKIP_UDP: { type: 'select', options: ['true', 'false'] },
                          ALLOW_PRIVATE_BACKENDS: { type: 'select', options: ['true', 'false'] }
                        }[key];

                        return (
                          <div key={key}>
                            <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">
                              {key}
                            </label>
                            {fieldConfig?.type === 'select' ? (
                              <select
                                value={String(value)}
                                onChange={(e) => setConfigForm(prev => ({ ...prev, [key]: e.target.value }))}
                                className="input-futuristic text-xs"
                              >
                                {fieldConfig.options.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={isSecret ? 'password' : 'text'}
                                value={String(value)}
                                onChange={(e) => setConfigForm(prev => ({ ...prev, [key]: e.target.value }))}
                                className="input-futuristic text-xs"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleValidateConfig}
                    disabled={configSubmitting}
                    className="btn-secondary flex items-center gap-2 text-xs px-4 py-2.5"
                  >
                    <Shield className="w-4 h-4" strokeWidth={1.5} />
                    Validate
                  </button>
                  <button
                    type="submit"
                    disabled={configSubmitting}
                    className="btn-primary flex items-center gap-2 text-xs px-4 py-2.5"
                  >
                    <Shield className="w-4 h-4" strokeWidth={1.5} />
                    {configSubmitting ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Backups Panel */}
        {activeTab === 'backups' && (
          <div className="max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <DatabaseBackup />
          </div>
        )}

        {/* Updates Panel */}
        {activeTab === 'updates' && <UpdatesPanel />}

        {/* Domains Table */}
        {activeTab === 'domains' && (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px]">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Hostname</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Owner</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Team</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Backend</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Type</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">SSL</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Status</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map(domain => (
                    <tr key={domain.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-500">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                          <p className="text-xs font-normal text-white">{domain.hostname}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-white/70">{domain.user_display_name || domain.username || 'N/A'}</td>
                      <td className="px-5 py-3 text-xs text-white/70">{domain.team_name || '-'}</td>
                      <td className="px-5 py-3 text-xs text-white/60 font-light">{domain.backend_url}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                          domain.proxy_type === 'http' ? 'bg-[#9D4EDD]/10 text-[#C77DFF] border border-[#9D4EDD]/20' :
                          domain.proxy_type === 'tcp' ? 'bg-[#06B6D4]/10 text-[#22D3EE] border border-[#06B6D4]/20' :
                          'bg-[#F59E0B]/10 text-[#FBBF24] border border-[#F59E0B]/20'
                        }`}>
                          {domain.proxy_type?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {domain.ssl_enabled ? (
                          <Shield className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                        ) : (
                          <span className="text-white/30">-</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                          <div className={`w-2 h-2 rounded-full ${domain.is_active ? 'bg-[#34D399]' : 'bg-white/40'}`} />
                          {domain.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => openEditDomain(domain)}
                          className="p-2 text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded-lg transition-all duration-500 active:scale-98"
                          title="Edit domain"
                        >
                          <Edit className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {domains.length === 0 && !loading && (
              <div className="p-12 text-center">
                <p className="text-white/40 font-light tracking-wide text-xs">No domains found</p>
              </div>
            )}
          </div>
        )}

        {/* Teams Table */}
        {activeTab === 'teams' && (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Team Name</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Members</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Domains</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Quota</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Created</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map(team => (
                    <tr key={team.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-500">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <UserCheck className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                          <p className="text-xs font-normal text-white">{team.name}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-white/40" strokeWidth={1.5} />
                          <span className="text-xs text-white/70">{team.member_count}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-white/40" strokeWidth={1.5} />
                          <span className="text-xs text-white/70">{team.domain_count}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/60">{team.domain_quota}</span>
                          <div className="w-20 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#9D4EDD] to-[#C77DFF] transition-all duration-500"
                              style={{ width: `${Math.min((team.domain_count / (team.domain_quota || 1)) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-white/50 font-light">
                        {team.created_at ? new Date(team.created_at).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => openEditTeamQuota(team)}
                          className="p-2 text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded-lg transition-all duration-500 active:scale-98"
                          title="Edit team quota"
                        >
                          <Edit className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {teams.length === 0 && !loading && (
              <div className="p-12 text-center">
                <p className="text-white/40 font-light tracking-wide text-xs">No teams found</p>
              </div>
            )}
          </div>
        )}

        {/* Redirections Table */}
        {activeTab === 'redirections' && (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px]">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Short Code</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Target URL</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Owner</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Team</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Clicks</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Status</th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {redirections.map(redirection => (
                    <tr key={redirection.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-500">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <LinkIcon className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                          <code className="text-xs font-mono text-white">/r/{redirection.short_code}</code>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <a
                          href={redirection.target_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-white/60 hover:text-white/90 font-mono transition-colors truncate block max-w-xs"
                          title={redirection.target_url}
                        >
                          {redirection.target_url}
                        </a>
                      </td>
                      <td className="px-5 py-3 text-xs text-white/70">{redirection.user_display_name || redirection.username || 'N/A'}</td>
                      <td className="px-5 py-3 text-xs text-white/70">{redirection.team_name || '-'}</td>
                      <td className="px-5 py-3 text-xs text-white font-normal">{redirection.click_count || 0}</td>
                      <td className="px-5 py-3">
                        <span className={redirection.is_active ? 'badge-success' : 'badge-purple'}>
                          <div className={`w-2 h-2 rounded-full ${redirection.is_active ? 'bg-[#34D399]' : 'bg-white/40'}`} />
                          {redirection.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditRedirection(redirection)}
                            className="p-2 text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded-lg transition-all duration-500 active:scale-98"
                            title="Edit redirection"
                          >
                            <Edit className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => handleToggleRedirection(redirection)}
                            className="p-2 text-[#FBBF24] hover:bg-[#F59E0B]/10 rounded-lg transition-all duration-500 active:scale-98"
                            title="Toggle Status"
                          >
                            <Power className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => handleDeleteRedirection(redirection)}
                            className="p-2 text-[#F87171] hover:bg-[#F87171]/10 rounded-lg transition-all duration-500 active:scale-98"
                            title="Delete Redirection"
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {redirections.length === 0 && !loading && (
              <div className="p-12 text-center">
                <p className="text-white/40 font-light tracking-wide text-xs">No redirections found</p>
              </div>
            )}
          </div>
        )}

        {/* Statistics */}
        {activeTab === 'stats' && stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatsCard
              icon={Users}
              title="Users"
              value={stats.totalUsers}
              subtitle="Registered"
              variant="purple"
              delay="0.2s"
            />

            <StatsCard
              icon={Globe}
              title="Domains"
              value={stats.totalDomains}
              subtitle={`${stats.activeDomains} active`}
              variant="success"
              delay="0.3s"
            />

            <StatsCard
              icon={Shield}
              title="SSL"
              value={stats.sslEnabledDomains}
              subtitle={`${stats.activeSSLDomains} active`}
              variant="warning"
              delay="0.4s"
            />

            <StatsCard
              icon={BarChart3}
              title="Active"
              value={stats.activeDomains}
              subtitle={`${Math.round((stats.activeDomains / (stats.totalDomains || 1)) * 100)}% total`}
              badge={`${Math.round((stats.activeDomains / (stats.totalDomains || 1)) * 100)}%`}
              variant="info"
              delay="0.5s"
            />
          </div>
        )}
      </div>

      {/* Edit Quotas Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-md w-full animate-scale-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-light text-white tracking-tight">Edit Quotas</h2>
                <p className="text-xs text-white/60 font-light mt-1 tracking-wide">{editingUser.display_name}</p>
              </div>
              <button
                onClick={closeEditQuotas}
                disabled={submitting}
                className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-500 disabled:opacity-30 active:scale-98"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleUpdateQuotas} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Max Domains
                </label>
                <input
                  type="number"
                  value={quotaForm.maxDomains}
                  onChange={(e) => setQuotaForm({ ...quotaForm, maxDomains: parseInt(e.target.value) })}
                  min="0"
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Max Redirections
                </label>
                <input
                  type="number"
                  value={quotaForm.maxRedirections}
                  onChange={(e) => setQuotaForm({ ...quotaForm, maxRedirections: parseInt(e.target.value) })}
                  min="0"
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeEditQuotas}
                  disabled={submitting}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTeam && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-md w-full animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-light text-white tracking-tight">Edit Team Quota</h2>
                <p className="text-xs text-white/60 font-light mt-1 tracking-wide">{editingTeam.name}</p>
              </div>
              <button
                onClick={closeEditTeamQuota}
                disabled={submitting}
                className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-500 disabled:opacity-30 active:scale-98"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleUpdateTeamQuota} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Max Domains
                </label>
                <input
                  type="number"
                  value={teamQuotaForm.maxDomains}
                  onChange={(e) => setTeamQuotaForm({ ...teamQuotaForm, maxDomains: parseInt(e.target.value) })}
                  min="0"
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeEditTeamQuota}
                  disabled={submitting}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingDomain && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-2xl w-full animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-light text-white tracking-tight">Edit Domain</h2>
                <p className="text-xs text-white/60 font-light mt-1 tracking-wide">{editingDomain.hostname}</p>
              </div>
              <button
                onClick={closeEditDomain}
                disabled={domainSubmitting}
                className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-500 disabled:opacity-30 active:scale-98"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleUpdateDomain} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Owner
                  </label>
                  <select
                    name="ownerId"
                    value={domainForm.ownerId}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting}
                    className="input-futuristic text-xs"
                  >
                    {domainUsers.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.display_name || user.username}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Team
                  </label>
                  <select
                    name="teamId"
                    value={domainForm.teamId}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting}
                    className="input-futuristic text-xs"
                  >
                    <option value="">Personal (no team)</option>
                    {domainTeams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Hostname
                  </label>
                  <input
                    type="text"
                    name="hostname"
                    value={domainForm.hostname}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting}
                    className="input-futuristic text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Proxy Type
                  </label>
                  <select
                    name="proxyType"
                    value={domainForm.proxyType}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting}
                    className="input-futuristic text-xs"
                  >
                    <option value="http">HTTP</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Backend URL
                  </label>
                  <input
                    type="text"
                    name="backendUrl"
                    value={domainForm.backendUrl}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting}
                    className="input-futuristic text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Backend Port
                  </label>
                  <input
                    type="text"
                    name="backendPort"
                    value={domainForm.backendPort}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting}
                    className="input-futuristic text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    External Port
                  </label>
                  <input
                    type="text"
                    name="externalPort"
                    value={domainForm.externalPort}
                    onChange={handleDomainFormChange}
                    disabled={domainSubmitting || domainForm.proxyType === 'http'}
                    placeholder={domainForm.proxyType === 'http' ? 'Not used for HTTP' : 'Leave empty for auto'}
                    className="input-futuristic text-xs"
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] h-full">
                  <div>
                    <label htmlFor="isActive" className="text-xs font-medium text-white cursor-pointer block">
                      Active
                    </label>
                    <p className="text-xs text-white/40 mt-0.5">
                      Enable or disable this domain
                    </p>
                  </div>
                  <Switch
                    id="isActive"
                    checked={domainForm.isActive}
                    onCheckedChange={(checked) => setDomainForm({ ...domainForm, isActive: checked })}
                    disabled={domainSubmitting}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Description
                </label>
                <input
                  type="text"
                  name="description"
                  value={domainForm.description}
                  onChange={handleDomainFormChange}
                  disabled={domainSubmitting}
                  className="input-futuristic text-xs"
                />
              </div>

              {domainForm.proxyType === 'http' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                    <div>
                      <label htmlFor="sslEnabled" className="text-xs font-medium text-white cursor-pointer block">
                        SSL/TLS
                      </label>
                      <p className="text-xs text-white/40 mt-0.5">
                        Enable SSL/TLS for this domain
                      </p>
                    </div>
                    <Switch
                      id="sslEnabled"
                      checked={domainForm.sslEnabled}
                      onCheckedChange={(checked) => setDomainForm({ ...domainForm, sslEnabled: checked })}
                      disabled={domainSubmitting}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                      Challenge Type
                    </label>
                    <select
                      name="challengeType"
                      value={domainForm.challengeType}
                      onChange={handleDomainFormChange}
                      disabled={domainSubmitting || !domainForm.sslEnabled || domainForm.hostname.startsWith('*.')}
                      className="input-futuristic text-xs"
                    >
                      <option value="http-01">HTTP-01</option>
                      <option value="dns-01">DNS-01</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeEditDomain}
                  disabled={domainSubmitting}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={domainSubmitting}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                >
                  {domainSubmitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Redirection Modal */}
      {editingRedirection && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-2xl w-full animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-light text-white tracking-tight">Edit Redirection</h2>
                <p className="text-xs text-white/60 font-light mt-1 tracking-wide">/r/{editingRedirection.short_code}</p>
              </div>
              <button
                onClick={closeEditRedirection}
                disabled={submitting}
                className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-500 disabled:opacity-30 active:scale-98"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleUpdateRedirection} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Short Code (read-only)
                </label>
                <input
                  type="text"
                  value={redirectionForm.shortCode}
                  disabled
                  className="input-futuristic text-xs bg-white/[0.02] cursor-not-allowed"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Target URL
                </label>
                <input
                  type="url"
                  name="targetUrl"
                  value={redirectionForm.targetUrl}
                  onChange={handleRedirectionFormChange}
                  disabled={submitting}
                  required
                  className="input-futuristic text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Description (optional)
                </label>
                <input
                  type="text"
                  name="description"
                  value={redirectionForm.description}
                  onChange={handleRedirectionFormChange}
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                <div>
                  <label htmlFor="redirectionIsActive" className="text-xs font-medium text-white cursor-pointer block">
                    Active
                  </label>
                  <p className="text-xs text-white/40 mt-0.5">
                    Enable or disable this redirection
                  </p>
                </div>
                <Switch
                  id="redirectionIsActive"
                  checked={redirectionForm.isActive}
                  onCheckedChange={(checked) => setRedirectionForm({ ...redirectionForm, isActive: checked })}
                  disabled={submitting}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeEditRedirection}
                  disabled={submitting}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
