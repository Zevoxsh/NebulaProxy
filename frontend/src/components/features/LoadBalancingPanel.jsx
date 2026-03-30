import { useState, useEffect } from 'react';
import {
  Server, Plus, Trash2, Power, PowerOff, Edit2, Save, X,
  RefreshCw, AlertCircle, CheckCircle, Settings, Layers,
  Activity, Shuffle
} from 'lucide-react';
import { domainAPI } from '../../api/client';

const ALGORITHMS = [
  { value: 'round-robin', label: 'Round Robin', description: 'Distribue les requêtes de manière cyclique' },
  { value: 'random', label: 'Random', description: 'Sélection aléatoire du backend' },
  { value: 'ip-hash', label: 'IP Hash', description: 'Sticky sessions basées sur l\'IP client' },
  { value: 'least-connections', label: 'Least Connections', description: 'Backend avec le moins de connexions actives' },
  { value: 'sticky-session', label: 'Sticky Session', description: 'Cookie __nebula_srv pour ancrer le client à un backend' },
  { value: 'ab-test', label: 'A/B Test', description: 'Répartition pondérée (ab_weight par backend)' }
];

export default function LoadBalancingPanel({ domainId, onUpdate }) {
  const [backends, setBackends] = useState([]);
  const [loadBalancingEnabled, setLoadBalancingEnabled] = useState(false);
  const [algorithm, setAlgorithm] = useState('round-robin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state for adding new backend
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBackend, setNewBackend] = useState({ backendUrl: '', backendPort: '', weight: 1, priority: 0, abWeight: 50 });
  const [addingBackend, setAddingBackend] = useState(false);

  // Edit state
  const [editingBackendId, setEditingBackendId] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    loadBackends();
  }, [domainId]);

  const loadBackends = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await domainAPI.getBackends(domainId);
      setBackends(response.data.backends || []);
      setLoadBalancingEnabled(response.data.load_balancing_enabled || false);
      setAlgorithm(response.data.load_balancing_algorithm || 'round-robin');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load backends');
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (msg, isError = false) => {
    if (isError) {
      setError(msg);
      setSuccess('');
    } else {
      setSuccess(msg);
      setError('');
    }
    setTimeout(() => {
      setError('');
      setSuccess('');
    }, 3000);
  };

  const handleToggleLoadBalancing = async () => {
    setSaving(true);
    try {
      await domainAPI.updateLoadBalancing(domainId, {
        enabled: !loadBalancingEnabled,
        algorithm
      });
      setLoadBalancingEnabled(!loadBalancingEnabled);
      showMessage(loadBalancingEnabled ? 'Load balancing disabled' : 'Load balancing enabled');
      if (onUpdate) onUpdate();
    } catch (err) {
      showMessage(err.response?.data?.message || 'Failed to update load balancing', true);
    } finally {
      setSaving(false);
    }
  };

  const handleAlgorithmChange = async (newAlgorithm) => {
    setSaving(true);
    try {
      await domainAPI.updateLoadBalancing(domainId, {
        enabled: loadBalancingEnabled,
        algorithm: newAlgorithm
      });
      setAlgorithm(newAlgorithm);
      showMessage('Algorithm updated');
      if (onUpdate) onUpdate();
    } catch (err) {
      showMessage(err.response?.data?.message || 'Failed to update algorithm', true);
    } finally {
      setSaving(false);
    }
  };

  const handleAddBackend = async (e) => {
    e.preventDefault();
    if (!newBackend.backendUrl) {
      showMessage('Backend URL is required', true);
      return;
    }

    setAddingBackend(true);
    try {
      await domainAPI.createBackend(domainId, { ...newBackend, ab_weight: newBackend.abWeight });
      setNewBackend({ backendUrl: '', backendPort: '', weight: 1, priority: 0, abWeight: 50 });
      setShowAddForm(false);
      showMessage('Backend added successfully');
      loadBackends();
      if (onUpdate) onUpdate();
    } catch (err) {
      showMessage(err.response?.data?.message || 'Failed to add backend', true);
    } finally {
      setAddingBackend(false);
    }
  };

  const handleDeleteBackend = async (backendId) => {
    if (!confirm('Are you sure you want to delete this backend?')) return;

    try {
      await domainAPI.deleteBackend(domainId, backendId);
      showMessage('Backend deleted');
      loadBackends();
      if (onUpdate) onUpdate();
    } catch (err) {
      showMessage(err.response?.data?.message || 'Failed to delete backend', true);
    }
  };

  const handleToggleBackend = async (backendId) => {
    try {
      await domainAPI.toggleBackend(domainId, backendId);
      showMessage('Backend status updated');
      loadBackends();
      if (onUpdate) onUpdate();
    } catch (err) {
      showMessage(err.response?.data?.message || 'Failed to toggle backend', true);
    }
  };

  const startEditBackend = (backend) => {
    setEditingBackendId(backend.id);
    setEditForm({
      backendUrl: backend.backend_url,
      backendPort: backend.backend_port || '',
      weight: backend.weight || 1,
      priority: backend.priority || 0,
      abWeight: backend.ab_weight !== undefined ? backend.ab_weight : 50
    });
  };

  const cancelEdit = () => {
    setEditingBackendId(null);
    setEditForm({});
  };

  const saveEditBackend = async (backendId) => {
    try {
      await domainAPI.updateBackend(domainId, backendId, { ...editForm, ab_weight: editForm.abWeight });
      setEditingBackendId(null);
      setEditForm({});
      showMessage('Backend updated');
      loadBackends();
      if (onUpdate) onUpdate();
    } catch (err) {
      showMessage(err.response?.data?.message || 'Failed to update backend', true);
    }
  };

  const getHealthStatusBadge = (status) => {
    switch (status) {
      case 'up':
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 bg-[#10B981]/15 text-[#34D399] rounded-full text-xs font-medium border border-[#10B981]/30">
            <CheckCircle className="w-3 h-3" strokeWidth={2} />
            Healthy
          </span>
        );
      case 'down':
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 bg-[#EF4444]/15 text-[#F87171] rounded-full text-xs font-medium border border-[#EF4444]/30">
            <AlertCircle className="w-3 h-3" strokeWidth={2} />
            Down
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.05] text-white/50 rounded-full text-xs font-medium border border-white/[0.08]">
            <Activity className="w-3 h-3" strokeWidth={2} />
            Unknown
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center justify-center gap-3 py-8">
          <RefreshCw className="w-5 h-5 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
          <span className="text-white/70 font-light">Loading backends...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl  overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/[0.08]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center">
              <Layers className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-lg font-light text-white tracking-tight">Load Balancing</h2>
              <p className="text-xs text-white/50 font-light">Distribute traffic across multiple backends</p>
            </div>
          </div>

          {/* Toggle Load Balancing */}
          <button
            onClick={handleToggleLoadBalancing}
            disabled={saving}
            className={`px-4 py-2 rounded-lg font-light text-sm flex items-center gap-2 transition-all duration-500 ${
              loadBalancingEnabled
                ? 'bg-gradient-to-r from-[#10B981] to-[#059669] text-white'
                : 'bg-white/[0.02] border border-white/[0.08] text-white/70 hover:border-[#9D4EDD]/30'
            }`}
          >
            {loadBalancingEnabled ? (
              <>
                <Power className="w-4 h-4" strokeWidth={1.5} />
                Enabled
              </>
            ) : (
              <>
                <PowerOff className="w-4 h-4" strokeWidth={1.5} />
                Disabled
              </>
            )}
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="mt-4 p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#F87171]" strokeWidth={1.5} />
            <span className="text-sm text-[#F87171] font-light">{error}</span>
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 bg-[#10B981]/10 border border-[#10B981]/20 rounded-lg flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
            <span className="text-sm text-[#34D399] font-light">{success}</span>
          </div>
        )}
      </div>

      {/* Algorithm Selection */}
      {loadBalancingEnabled && (
        <div className="p-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3 mb-4">
            <Shuffle className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
            <span className="text-sm font-medium text-white/70">Distribution Algorithm</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {ALGORITHMS.map((alg) => (
              <button
                key={alg.value}
                onClick={() => handleAlgorithmChange(alg.value)}
                disabled={saving}
                className={`p-3 rounded-lg text-left transition-all duration-300 ${
                  algorithm === alg.value
                    ? 'bg-[#9D4EDD]/20 border border-[#9D4EDD]/40 text-white'
                    : 'bg-white/[0.02] border border-white/[0.08] text-white/70 hover:border-[#9D4EDD]/30'
                }`}
              >
                <p className="text-sm font-medium">{alg.label}</p>
                <p className="text-xs text-white/50 mt-1">{alg.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backends List */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Server className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
            <span className="text-sm font-medium text-white/70">
              Backend Servers ({backends.length})
            </span>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-3 py-1.5 bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] hover:from-[#7B2CBF] hover:to-[#5B1F9C] text-white rounded-lg text-sm font-light flex items-center gap-2 transition-all duration-500"
          >
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            Add Backend
          </button>
        </div>

        {/* Add Backend Form */}
        {showAddForm && (
          <form onSubmit={handleAddBackend} className="mb-4 p-4 bg-white/[0.02] border border-white/[0.08] rounded-xl">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Backend URL *
                </label>
                <input
                  type="text"
                  value={newBackend.backendUrl}
                  onChange={(e) => setNewBackend({ ...newBackend, backendUrl: e.target.value })}
                  placeholder="http://192.168.1.10 or https://backend.example.com"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 placeholder-white/30 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Port (optional)
                </label>
                <input
                  type="number"
                  value={newBackend.backendPort}
                  onChange={(e) => setNewBackend({ ...newBackend, backendPort: e.target.value })}
                  placeholder="8080"
                  min="1"
                  max="65535"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 placeholder-white/30 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  Weight
                </label>
                <input
                  type="number"
                  value={newBackend.weight}
                  onChange={(e) => setNewBackend({ ...newBackend, weight: parseInt(e.target.value) || 1 })}
                  min="1"
                  max="100"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 placeholder-white/30 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                />
              </div>
            </div>
            {algorithm === 'ab-test' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                  A/B Weight (0-100)
                </label>
                <input
                  type="number"
                  value={newBackend.abWeight}
                  onChange={(e) => setNewBackend({ ...newBackend, abWeight: parseInt(e.target.value) ?? 50 })}
                  min="0"
                  max="100"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 placeholder-white/30 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                />
                <p className="text-xs text-white/40 mt-1">Part relative du trafic A/B pour ce backend (ex. 70 = 70%)</p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={addingBackend}
                className="px-4 py-2 bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] hover:from-[#7B2CBF] hover:to-[#5B1F9C] text-white rounded-lg text-sm font-light flex items-center gap-2 transition-all duration-500 disabled:opacity-50"
              >
                {addingBackend ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" strokeWidth={1.5} />
                    Add Backend
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewBackend({ backendUrl: '', backendPort: '', weight: 1, priority: 0 });
                }}
                className="px-4 py-2 bg-white/[0.02] border border-white/[0.08] text-white/70 hover:border-[#EF4444]/30 hover:text-[#F87171] rounded-lg text-sm font-light transition-all duration-500"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Backends Table */}
        {backends.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-white/[0.02] border border-white/[0.08] flex items-center justify-center">
              <Server className="w-6 h-6 text-white/30" strokeWidth={1.5} />
            </div>
            <p className="text-white/50 font-light mb-2">No backends configured</p>
            <p className="text-xs text-white/30">
              {loadBalancingEnabled
                ? 'Add backends to distribute traffic across multiple servers'
                : 'Enable load balancing and add backends to get started'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {backends.map((backend) => (
              <div
                key={backend.id}
                className={`p-4 rounded-xl border transition-all duration-300 ${
                  backend.is_active
                    ? 'bg-white/[0.02] border-white/[0.08] hover:border-[#9D4EDD]/30'
                    : 'bg-white/[0.01] border-white/[0.05] opacity-60'
                }`}
              >
                {editingBackendId === backend.id ? (
                  // Edit Mode
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-2">
                        <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                          Backend URL
                        </label>
                        <input
                          type="text"
                          value={editForm.backendUrl}
                          onChange={(e) => setEditForm({ ...editForm, backendUrl: e.target.value })}
                          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                          Port
                        </label>
                        <input
                          type="number"
                          value={editForm.backendPort}
                          onChange={(e) => setEditForm({ ...editForm, backendPort: e.target.value })}
                          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                          Weight
                        </label>
                        <input
                          type="number"
                          value={editForm.weight}
                          onChange={(e) => setEditForm({ ...editForm, weight: parseInt(e.target.value) || 1 })}
                          min="1"
                          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                        />
                      </div>
                    </div>
                    {algorithm === 'ab-test' && (
                      <div className="mt-4">
                        <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                          A/B Weight (0-100)
                        </label>
                        <input
                          type="number"
                          value={editForm.abWeight}
                          onChange={(e) => setEditForm({ ...editForm, abWeight: parseInt(e.target.value) ?? 50 })}
                          min="0"
                          max="100"
                          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-500"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveEditBackend(backend.id)}
                        className="px-3 py-1.5 bg-gradient-to-r from-[#10B981] to-[#059669] text-white rounded-lg text-sm font-light flex items-center gap-2 transition-all duration-500"
                      >
                        <Save className="w-4 h-4" strokeWidth={1.5} />
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 bg-white/[0.02] border border-white/[0.08] text-white/70 rounded-lg text-sm font-light transition-all duration-500"
                      >
                        <X className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        backend.is_active
                          ? 'bg-[#10B981]/10 border border-[#10B981]/20'
                          : 'bg-white/[0.02] border border-white/[0.08]'
                      }`}>
                        <Server className={`w-5 h-5 ${backend.is_active ? 'text-[#34D399]' : 'text-white/30'}`} strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="text-sm text-white font-light truncate">
                            {backend.backend_url}
                            {backend.backend_port && (
                              <span className="text-white/50">:{backend.backend_port}</span>
                            )}
                          </p>
                          {getHealthStatusBadge(backend.health_status)}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-white/50">
                          <span>Weight: {backend.weight || 1}</span>
                          {algorithm === 'ab-test' && (
                            <span className="text-[#FBBF24]">A/B: {backend.ab_weight ?? 50}%</span>
                          )}
                          {backend.last_response_time && (
                            <span>Response: {backend.last_response_time}ms</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggleBackend(backend.id)}
                        className={`p-2 rounded-lg transition-all duration-300 ${
                          backend.is_active
                            ? 'bg-[#10B981]/10 border border-[#10B981]/20 text-[#34D399] hover:bg-[#10B981]/20'
                            : 'bg-white/[0.02] border border-white/[0.08] text-white/50 hover:border-[#10B981]/30 hover:text-[#34D399]'
                        }`}
                        title={backend.is_active ? 'Disable backend' : 'Enable backend'}
                      >
                        {backend.is_active ? (
                          <Power className="w-4 h-4" strokeWidth={1.5} />
                        ) : (
                          <PowerOff className="w-4 h-4" strokeWidth={1.5} />
                        )}
                      </button>
                      <button
                        onClick={() => startEditBackend(backend)}
                        className="p-2 bg-white/[0.02] border border-white/[0.08] text-white/50 hover:border-[#9D4EDD]/30 hover:text-[#C77DFF] rounded-lg transition-all duration-300"
                        title="Edit backend"
                      >
                        <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDeleteBackend(backend.id)}
                        className="p-2 bg-white/[0.02] border border-white/[0.08] text-white/50 hover:border-[#EF4444]/30 hover:text-[#F87171] rounded-lg transition-all duration-300"
                        title="Delete backend"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
