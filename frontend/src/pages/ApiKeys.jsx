import { useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, AlertCircle, Activity, Loader, X as XIcon } from 'lucide-react';
import { apiKeysAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import AccountNav from '../components/features/AccountNav';
import { SectionCard, SectionHeader } from '../components/ui/section-card';

export default function ApiKeys() {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [apiKeys, setApiKeys] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newApiKey, setNewApiKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [usageStats, setUsageStats] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [keyFormData, setKeyFormData] = useState({
    name: '', description: '', scopes: [], expiresInDays: 365, rateLimitRpm: 60, rateLimitRph: 3600
  });

  const availableScopes = {
    'domains:*': 'Full access to domains',
    'domains:read': 'Read domains',
    'domains:write': 'Create & update domains',
    'domains:delete': 'Delete domains',
    'teams:*': 'Full access to teams',
    'teams:read': 'Read teams',
    'teams:write': 'Create & update teams',
    'teams:delete': 'Delete teams',
    'ssl:*': 'Full access to SSL certificates',
    'ssl:read': 'Read SSL certificates',
    'ssl:write': 'Create & update SSL certificates',
    'backends:*': 'Full access to backends',
    'backends:read': 'Read backends',
    'monitoring:read': 'Read monitoring data',
    ...(user?.role === 'admin' ? { 'users:*': 'Full access to users (admin)', 'users:read': 'Read users (admin)' } : {})
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await apiKeysAPI.list();
      setApiKeys(res.data.apiKeys || []);
    } catch {
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  const fetchApiKeys = async () => {
    try { const r = await apiKeysAPI.list(); setApiKeys(r.data.apiKeys || []); } catch { /* ignore */ }
  };

  const fetchUsageStats = async (keyId) => {
    try { setLoadingUsage(true); const r = await apiKeysAPI.getUsage(keyId); setUsageStats(r.data); } catch { /* ignore */ }
    finally { setLoadingUsage(false); }
  };

  const handleCreateKey = async () => {
    try {
      if (!keyFormData.name || keyFormData.scopes.length === 0) { alert('Name and at least one scope are required.'); return; }
      const response = await apiKeysAPI.create(keyFormData);
      setNewApiKey(response.data); setShowCreateModal(false); fetchApiKeys();
      setKeyFormData({ name: '', description: '', scopes: [], expiresInDays: 365, rateLimitRpm: 60, rateLimitRph: 3600 });
    } catch (err) { alert(err.response?.data?.message || 'Failed to create API key'); }
  };

  const handleDeleteKey = async (keyId) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    try { await apiKeysAPI.delete(keyId); fetchApiKeys(); if (selectedKey === keyId) { setSelectedKey(null); setUsageStats(null); } }
    catch { alert('Failed to delete API key'); }
  };

  const handleCopy = (text) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const toggleScope = (scope) => setKeyFormData(prev => ({ ...prev, scopes: prev.scopes.includes(scope) ? prev.scopes.filter(s => s !== scope) : [...prev.scopes, scope] }));
  const formatDate = (d) => d ? new Date(d).toLocaleString() : 'Never';
  const isExpired = (d) => d ? new Date(d) < new Date() : false;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <div className="flex items-center gap-3 text-zinc-500 text-sm">
          <Loader className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <h1 className="text-2xl font-semibold text-white tracking-tight">API Keys</h1>
          <p className="text-sm text-zinc-500 mt-1">Programmatic access to the NebulaProxy API</p>
          <div className="mt-4">
            <AccountNav current="api-keys" />
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="mb-5 flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* New key reveal modal */}
        {newApiKey && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-lg w-full animate-scale-in">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                  <Check className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">API key created</p>
                  <p className="text-xs text-zinc-500">Copy it now — it won&apos;t be shown again.</p>
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-500">Your API key</span>
                  <button onClick={() => handleCopy(newApiKey.apiKey)} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <code className="text-sm text-white font-mono break-all">{newApiKey.apiKey}</code>
              </div>
              <div className="flex items-start gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-4">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300/80">Save this key somewhere safe. It cannot be recovered after this screen.</p>
              </div>
              <button onClick={() => setNewApiKey(null)} className="btn-primary w-full text-sm">I&apos;ve saved my key</button>
            </div>
          </div>
        )}

        {/* Create modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
              <div className="flex items-center justify-between mb-5">
                <p className="text-base font-semibold text-white">Create API key</p>
                <button onClick={() => setShowCreateModal(false)} className="text-zinc-500 hover:text-white transition-colors">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name <span className="text-red-400">*</span></label>
                  <input type="text" value={keyFormData.name} onChange={(e) => setKeyFormData({ ...keyFormData, name: e.target.value })} placeholder="e.g. Production API" className="input-futuristic text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
                  <textarea value={keyFormData.description} onChange={(e) => setKeyFormData({ ...keyFormData, description: e.target.value })} placeholder="What is this key used for?" className="input-futuristic text-sm" rows={2} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">Permissions <span className="text-red-400">*</span></label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {Object.entries(availableScopes).map(([scope, description]) => (
                      <label key={scope} className="flex items-start gap-2.5 p-3 rounded-lg border border-[#27272a] hover:border-zinc-600 cursor-pointer transition-colors bg-white/[0.02]">
                        <input type="checkbox" checked={keyFormData.scopes.includes(scope)} onChange={() => toggleScope(scope)} className="mt-0.5 w-4 h-4 accent-white" />
                        <div>
                          <p className="text-xs text-white font-mono">{scope}</p>
                          <p className="text-xs text-zinc-500">{description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Expires in (days)</label>
                    <input type="number" value={keyFormData.expiresInDays} onChange={(e) => setKeyFormData({ ...keyFormData, expiresInDays: parseInt(e.target.value) })} min="1" max="365" className="input-futuristic text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Limit / minute</label>
                    <input type="number" value={keyFormData.rateLimitRpm} onChange={(e) => setKeyFormData({ ...keyFormData, rateLimitRpm: parseInt(e.target.value) })} min="1" className="input-futuristic text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Limit / hour</label>
                    <input type="number" value={keyFormData.rateLimitRph} onChange={(e) => setKeyFormData({ ...keyFormData, rateLimitRph: parseInt(e.target.value) })} min="1" className="input-futuristic text-sm" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={handleCreateKey} disabled={!keyFormData.name || keyFormData.scopes.length === 0} className="btn-primary flex-1 text-sm">Create key</button>
                  <button onClick={() => setShowCreateModal(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Usage stats modal */}
        {selectedKey && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
              <div className="flex items-center justify-between mb-5">
                <p className="text-base font-semibold text-white">Usage statistics</p>
                <button onClick={() => { setSelectedKey(null); setUsageStats(null); }} className="text-zinc-500 hover:text-white transition-colors">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
              {loadingUsage ? (
                <div className="flex items-center justify-center py-12 gap-3 text-zinc-500 text-sm">
                  <Loader className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : usageStats && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    {[
                      { label: 'Total requests', value: usageStats.stats.total_requests, color: 'text-white' },
                      { label: 'Successful', value: usageStats.stats.success_count, color: 'text-emerald-400' },
                      { label: 'Client errors', value: usageStats.stats.client_error_count, color: 'text-amber-400' },
                      { label: 'Server errors', value: usageStats.stats.server_error_count, color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                        <p className="text-xs text-zinc-500 mb-1">{label}</p>
                        <p className={`text-2xl font-semibold ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                    <p className="text-xs font-medium text-zinc-400 px-4 py-3 border-b border-zinc-800">Recent requests</p>
                    <div className="max-h-56 overflow-y-auto">
                      {usageStats.recent_usage.map((req, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 last:border-0">
                          <div>
                            <span className="text-xs font-mono text-zinc-400 mr-2">{req.method}</span>
                            <span className="text-xs text-zinc-500">{req.path}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-zinc-600">{formatDate(req.created_at)}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${req.status_code < 300 ? 'bg-emerald-500/10 text-emerald-400' : req.status_code < 500 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                              {req.status_code}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <SectionCard>
          <SectionHeader
            icon={Key}
            title="API keys"
            description="Programmatic access to the NebulaProxy API"
            action={
              <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs px-3 py-2 shrink-0">
                <Plus className="w-3.5 h-3.5" /> New key
              </button>
            }
          />
          {apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-3">
                <Key className="w-5 h-5 text-zinc-600" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-zinc-300 mb-1">No API keys</p>
              <p className="text-xs text-zinc-600 mb-4">Create a key to access the API programmatically.</p>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary text-sm px-4">
                <Plus className="w-3.5 h-3.5" /> Create key
              </button>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
              {apiKeys.map((k) => (
                <div key={k.id} className="bg-white/[0.02] border border-[#27272a] rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white">{k.name}</p>
                        {isExpired(k.expiresAt) && <span className="badge-error">Expired</span>}
                        {!k.isActive && <span className="badge-warning">Inactive</span>}
                      </div>
                      {k.description && <p className="text-xs text-zinc-500 mt-0.5">{k.description}</p>}
                    </div>
                    <button onClick={() => handleDeleteKey(k.id)} className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-500/10">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1.5 text-xs mb-3">
                    <div className="flex justify-between"><span className="text-zinc-500">Prefix</span><code className="text-zinc-400 font-mono">{k.keyPrefix}…</code></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Last used</span><span className="text-zinc-400">{formatDate(k.lastUsedAt)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Expires</span><span className={isExpired(k.expiresAt) ? 'text-red-400' : 'text-zinc-400'}>{k.expiresAt ? formatDate(k.expiresAt) : 'Never'}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {k.scopes.map((s) => <span key={s} className="badge-info font-mono">{s}</span>)}
                  </div>
                  <button onClick={() => { setSelectedKey(k.id); fetchUsageStats(k.id); }} className="btn-secondary w-full text-xs flex items-center justify-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" /> View usage
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
