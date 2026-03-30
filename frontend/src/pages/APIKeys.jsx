import { useEffect, useState } from 'react';
import { Key, Plus, Trash2, Eye, EyeOff, Copy, Check, AlertCircle, RefreshCw, Activity, X as XIcon } from 'lucide-react';
import { apiKeysAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function APIKeys() {
  const user = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newApiKey, setNewApiKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [usageStats, setUsageStats] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    scopes: [],
    expiresInDays: 365,
    rateLimitRpm: 60,
    rateLimitRph: 3600
  });

  const availableScopes = {
    'domains:*': 'Full access to domain management',
    'domains:read': 'Read domain information',
    'domains:write': 'Create and update domains',
    'domains:delete': 'Delete domains',
    'teams:*': 'Full access to team management',
    'teams:read': 'Read team information',
    'teams:write': 'Create and update teams',
    'teams:delete': 'Delete teams',
    'ssl:*': 'Full access to SSL certificate management',
    'ssl:read': 'Read SSL certificate information',
    'ssl:write': 'Create and update SSL certificates',
    'backends:*': 'Full access to backend/load balancer management',
    'backends:read': 'Read backend information',
    'monitoring:read': 'Read monitoring and health check data',
    ...(user?.role === 'admin' ? {
      'users:*': 'Full access to user management (admin only)',
      'users:read': 'Read user information (admin only)',
    } : {})
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      setLoading(true);
      const response = await apiKeysAPI.list();
      setApiKeys(response.data.apiKeys || []);
    } catch (error) {
      console.error('Error fetching API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsageStats = async (keyId) => {
    try {
      setLoadingUsage(true);
      const response = await apiKeysAPI.getUsage(keyId);
      setUsageStats(response.data);
    } catch (error) {
      console.error('Error fetching usage stats:', error);
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleCreate = async () => {
    try {
      if (!formData.name || formData.scopes.length === 0) {
        alert('Name and at least one scope are required');
        return;
      }

      const response = await apiKeysAPI.create(formData);
      setNewApiKey(response.data);
      setShowCreateModal(false);
      fetchApiKeys();
      setFormData({
        name: '',
        description: '',
        scopes: [],
        expiresInDays: 365,
        rateLimitRpm: 60,
        rateLimitRph: 3600
      });
    } catch (error) {
      console.error('Error creating API key:', error);
      alert(error.response?.data?.message || 'Failed to create API key');
    }
  };

  const handleDelete = async (keyId) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      await apiKeysAPI.delete(keyId);
      fetchApiKeys();
      if (selectedKey === keyId) {
        setSelectedKey(null);
        setUsageStats(null);
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
      alert('Failed to delete API key');
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope) => {
    setFormData(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes, scope]
    }));
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const isExpired = (dateString) => {
    if (!dateString) return false;
    return new Date(dateString) < new Date();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading API keys...</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="mb-4 animate-fade-in flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">API Keys</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">Manage API keys for programmatic access</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary flex items-center gap-2 text-xs px-4 py-2.5"
              >
                <Plus size={16} />
                Add API Key
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* New API Key Display Modal */}
        {newApiKey && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="card-modal max-w-2xl w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Check className="text-green-400" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white">API Key Created</h3>
                  <p className="text-sm text-white/50">Save this key - it will not be shown again</p>
                </div>
              </div>

              <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/50 font-mono">API Key</span>
                  <button
                    onClick={() => handleCopy(newApiKey.apiKey)}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="text-sm text-white font-mono break-all">{newApiKey.apiKey}</code>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4 flex gap-3">
                <AlertCircle className="text-yellow-400 flex-shrink-0" size={18} />
                <p className="text-xs text-yellow-200">
                  This is the only time you will see this key. Make sure to save it in a secure location.
                </p>
              </div>

              <button
                onClick={() => setNewApiKey(null)}
                className="btn-primary w-full text-xs py-2.5"
              >
                I've saved this key
              </button>
            </div>
          </div>
        )}

        {/* Create Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-white">Create New API Key</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-white/50 hover:text-white"
                >
                  <XIcon size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-white/70 mb-2">Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Production API"
                    className="input-futuristic text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs text-white/70 mb-2">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Used for automated deployments"
                    className="input-futuristic text-xs"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-xs text-white/70 mb-3">Scopes *</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.entries(availableScopes).map(([scope, description]) => (
                      <label
                        key={scope}
                        className="flex items-start gap-2 p-3 bg-[#0d0e1a] border border-white/5 rounded-lg hover:border-white/10 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formData.scopes.includes(scope)}
                          onChange={() => toggleScope(scope)}
                          className="mt-1 w-4 h-4"
                        />
                        <div className="flex-1">
                          <div className="text-xs text-white font-mono">{scope}</div>
                          <div className="text-xs text-white/50">{description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-white/70 mb-2">Expires in (days)</label>
                    <input
                      type="number"
                      value={formData.expiresInDays}
                      onChange={(e) => setFormData({ ...formData, expiresInDays: parseInt(e.target.value) })}
                      min="1"
                      max="365"
                      className="input-futuristic text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-white/70 mb-2">Rate Limit (RPM)</label>
                    <input
                      type="number"
                      value={formData.rateLimitRpm}
                      onChange={(e) => setFormData({ ...formData, rateLimitRpm: parseInt(e.target.value) })}
                      min="1"
                      max="10000"
                      className="input-futuristic text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-white/70 mb-2">Rate Limit (RPH)</label>
                    <input
                      type="number"
                      value={formData.rateLimitRph}
                      onChange={(e) => setFormData({ ...formData, rateLimitRph: parseInt(e.target.value) })}
                      min="1"
                      max="100000"
                      className="input-futuristic text-xs"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCreate}
                    disabled={!formData.name || formData.scopes.length === 0}
                    className="btn-primary flex-1 text-xs px-4 py-2.5"
                  >
                    Create Key
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="btn-secondary flex-1 text-xs px-4 py-2.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* API Keys List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {apiKeys.length === 0 ? (
            <div className="col-span-full card-standard text-center">
              <Key className="mx-auto mb-4 text-white/30" size={48} />
              <h3 className="text-lg font-medium text-white mb-2">No API Keys</h3>
              <p className="text-sm text-white/50 mb-4">Create your first API key to get started</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5"
              >
                <Plus size={16} />
                Create API Key
              </button>
            </div>
          ) : (
            apiKeys.map((key) => (
              <div
                key={key.id}
                className="card-standard"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-medium text-white">{key.name}</h3>
                      {isExpired(key.expiresAt) && (
                        <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                          Expired
                        </span>
                      )}
                      {!key.isActive && (
                        <span className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-400">
                          Inactive
                        </span>
                      )}
                    </div>
                    {key.description && (
                      <p className="text-xs text-white/50">{key.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(key.id)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50">Prefix</span>
                    <code className="text-white/70 font-mono">{key.keyPrefix}...</code>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50">Created</span>
                    <span className="text-white/70">{formatDate(key.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50">Last Used</span>
                    <span className="text-white/70">{formatDate(key.lastUsedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50">Expires</span>
                    <span className={`${isExpired(key.expiresAt) ? 'text-red-400' : 'text-white/70'}`}>
                      {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {key.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono"
                    >
                      {scope}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setSelectedKey(key.id);
                    fetchUsageStats(key.id);
                  }}
                  className="btn-secondary w-full text-xs flex items-center justify-center gap-2"
                >
                  <Activity size={14} />
                  View Usage Stats
                </button>
              </div>
            ))
          )}
        </div>

        {/* Usage Stats Modal */}
        {selectedKey && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="card-modal max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-white">Usage Statistics</h3>
                <button
                  onClick={() => {
                    setSelectedKey(null);
                    setUsageStats(null);
                  }}
                  className="text-white/50 hover:text-white"
                >
                  <XIcon size={20} />
                </button>
              </div>

              {loadingUsage ? (
                <div className="text-center py-8">
                  <RefreshCw className="animate-spin mx-auto mb-2 text-white/50" size={32} />
                  <p className="text-sm text-white/50">Loading statistics...</p>
                </div>
              ) : usageStats && (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                      <div className="text-xs text-white/50 mb-1">Total Requests</div>
                      <div className="text-2xl font-light text-white">{usageStats.stats.total_requests}</div>
                    </div>
                    <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                      <div className="text-xs text-white/50 mb-1">Success</div>
                      <div className="text-2xl font-light text-green-400">{usageStats.stats.success_count}</div>
                    </div>
                    <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                      <div className="text-xs text-white/50 mb-1">Client Errors</div>
                      <div className="text-2xl font-light text-yellow-400">{usageStats.stats.client_error_count}</div>
                    </div>
                    <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                      <div className="text-xs text-white/50 mb-1">Server Errors</div>
                      <div className="text-2xl font-light text-red-400">{usageStats.stats.server_error_count}</div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-white mb-3">Recent Requests</h4>
                    <div className="bg-[#0d0e1a] border border-white/5 rounded-lg overflow-hidden">
                      <div className="max-h-64 overflow-y-auto">
                        {usageStats.recent_usage.map((req, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-3 border-b border-white/5 last:border-0"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-mono text-white/70">{req.method}</span>
                                <span className="text-xs text-white/50">{req.path}</span>
                              </div>
                              <div className="text-xs text-white/30">{formatDate(req.created_at)}</div>
                            </div>
                            <span
                              className={`text-xs px-2 py-0.5 rounded ${
                                req.status_code >= 200 && req.status_code < 300
                                  ? 'bg-green-500/10 text-green-400'
                                  : req.status_code >= 400 && req.status_code < 500
                                  ? 'bg-yellow-500/10 text-yellow-400'
                                  : 'bg-red-500/10 text-red-400'
                              }`}
                            >
                              {req.status_code}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
