import React, { useState, useEffect } from 'react';
import api from '../api/client';

const UpdatesPanel = () => {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  // Load status and history
  const loadData = async (silent = false) => {
    try {
      if (!silent) setError(null);
      const [statusRes, historyRes] = await Promise.all([
        api.get('/admin/updates/status'),
        api.get('/admin/updates/history')
      ]);

      setStatus(statusRes.data.data);
      setHistory(historyRes.data.data);
      if (!silent) setError(null); // Clear errors on successful load
    } catch (err) {
      // Don't show errors during updates (backend is restarting)
      if (!applying && !silent) {
        setError(err.response?.data?.error || 'Failed to load update data');
      }
    } finally {
      setLoading(false);
    }
  };

  // Check for updates manually
  const handleCheckForUpdates = async () => {
    setChecking(true);
    setError(null);
    try {
      // Trigger the check
      await api.post('/admin/updates/check');

      // Reload data to get fresh status
      const [statusRes, historyRes] = await Promise.all([
        api.get('/admin/updates/status'),
        api.get('/admin/updates/history')
      ]);

      const freshStatus = statusRes.data.data;
      const freshHistory = historyRes.data.data;

      // Update state
      setStatus(freshStatus);
      setHistory(freshHistory);

      // Show result based on fresh status
      if (freshStatus?.updateAvailable) {
        alert(`Update available!\n\nCurrent: ${freshStatus.currentCommit}\nNew: ${freshStatus.remoteCommit}\n\nClick "Apply Update Now" to install.`);
      } else {
        alert('No updates available. You are running the latest version.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check for updates');
    } finally {
      setChecking(false);
    }
  };

  // Apply update manually
  const handleApplyUpdate = async () => {
    if (!confirm('Apply update now? This will cause brief downtime (< 30 seconds).')) {
      return;
    }

    setApplying(true);
    setError(null);
    try {
      await api.post('/admin/updates/apply');
      alert('Update started. This page will refresh automatically when complete.');

      // Poll status until update completes
      const pollInterval = setInterval(async () => {
        try {
          const res = await api.get('/admin/updates/status');
          if (!res.data.data.updateInProgress) {
            clearInterval(pollInterval);
            await loadData(true); // Silent reload
            setApplying(false);
            alert('Update completed successfully!');
          }
        } catch (err) {
          // Server is restarting, keep polling silently
        }
      }, 3000);

      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setApplying(false);
      }, 300000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply update');
      setApplying(false);
    }
  };

  // Toggle auto-update
  const handleToggleAutoUpdate = async () => {
    const newState = !status.autoUpdateEnabled;
    const message = newState
      ? 'Enable auto-update? Updates will be applied automatically when available.'
      : 'Disable auto-update? You will need to apply updates manually.';

    if (!confirm(message)) {
      return;
    }

    try {
      await api.post('/admin/updates/toggle', { enabled: newState });
      await loadData();
      alert(`Auto-update ${newState ? 'enabled' : 'disabled'}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to toggle auto-update');
    }
  };

  // Rollback to specific update
  const handleRollback = async (updateId) => {
    if (!confirm(`Rollback to this version? This will cause brief downtime.`)) {
      return;
    }

    try {
      await api.post(`/admin/updates/rollback/${updateId}`);
      alert('Rollback started. The system will restart shortly.');
      setTimeout(() => loadData(), 10000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to rollback');
    }
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading update data...</div>
      </div>
    );
  }

  const getStatusBadge = (updateStatus) => {
    const badges = {
      success: 'bg-success/15 text-success-light border border-success/30',
      failed: 'bg-error/15 text-error-light border border-error/30',
      rolled_back: 'bg-warning/15 text-warning-light border border-warning/30',
      in_progress: 'bg-info/15 text-info-light border border-info/30'
    };
    return badges[updateStatus] || 'bg-white/5 text-white/40 border border-white/10';
  };

  const getStatusIcon = (updateStatus) => {
    const icons = {
      success: '✓',
      failed: '✗',
      rolled_back: '↺',
      in_progress: '⟳'
    };
    return icons[updateStatus] || '?';
  };

  return (
    <div className="page-shell">
      <div className="page-body space-y-4">
        {error && (
          <div className="bg-error/15 border border-error/30 text-error-light px-4 py-3 rounded-xl animate-fade-in">
            {error}
          </div>
        )}

        {/* Status Card */}
        <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl animate-fade-in">
        <h3 className="text-base font-light text-white tracking-tight mb-4">Current Status</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/60 font-medium mb-2">Current Version</p>
            <p className="text-lg font-mono font-light text-white">{status?.currentCommit || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-white/60 font-medium mb-2">Remote Version</p>
            <p className="text-lg font-mono font-light text-white">{status?.remoteCommit || 'Unknown'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {status?.updateAvailable && (
            <span className="badge-info">
              Update Available
            </span>
          )}
          {(status?.updateInProgress || applying) && (
            <span className="badge-warning animate-pulse">
              Update In Progress...
            </span>
          )}
          {!status?.updateAvailable && !status?.updateInProgress && (
            <span className="badge-success">
              Up to Date
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleCheckForUpdates}
            disabled={checking || applying || status?.updateInProgress}
            className="btn-primary"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>

          {status?.updateAvailable && (
            <button
              onClick={handleApplyUpdate}
              disabled={applying || status?.updateInProgress}
              className="btn-primary bg-gradient-to-br from-success to-success-dark hover:from-success-light hover:to-success"
            >
              {applying ? 'Applying...' : 'Apply Update Now'}
            </button>
          )}

          <button
            onClick={handleToggleAutoUpdate}
            disabled={applying || status?.updateInProgress}
            className={status?.autoUpdateEnabled ? 'btn-primary' : 'btn-secondary'}
          >
            Auto-Update: {status?.autoUpdateEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

        {/* Update History */}
        <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <h3 className="text-base font-light text-white tracking-tight mb-4">Update History</h3>

          {history.length === 0 ? (
            <p className="text-white/60 font-light">No update history available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-2">
                      Status
                    </th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-2">
                      Version
                    </th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-2">
                      Date
                    </th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-2">
                      Downtime
                    </th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-2">
                      Changes
                    </th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-2">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((update) => (
                    <tr key={update.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-300">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide px-2 py-1 rounded ${getStatusBadge(update.update_status)}`}>
                          {getStatusIcon(update.update_status)} {update.update_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-white/90 font-mono font-light">
                          {update.from_commit} → {update.to_commit}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/60 font-light">
                        {new Date(update.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/60 font-light">
                        {update.downtime_seconds ? `${update.downtime_seconds}s` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {update.migrations_applied?.length > 0 && (
                            <span className="bg-[#9D4EDD]/15 text-[#C77DFF] border border-[#9D4EDD]/30 px-2 py-1 rounded text-xs font-medium">
                              DB
                            </span>
                          )}
                          {update.backend_rebuilt && (
                            <span className="bg-info/15 text-info-light border border-info/30 px-2 py-1 rounded text-xs font-medium">
                              BE
                            </span>
                          )}
                          {update.frontend_rebuilt && (
                            <span className="bg-success/15 text-success-light border border-success/30 px-2 py-1 rounded text-xs font-medium">
                              FE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {update.update_status === 'success' && (
                          <button
                            onClick={() => handleRollback(update.id)}
                            className="text-warning-light hover:text-warning font-medium text-xs transition-colors"
                            disabled={status?.updateInProgress}
                          >
                            Rollback
                          </button>
                        )}
                        {update.update_status === 'rolled_back' && update.rollback_reason && (
                          <span className="text-xs text-white/40 font-light" title={update.rollback_reason}>
                            {update.rollback_reason.substring(0, 30)}...
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Auto-Update Info */}
        {status?.autoUpdateEnabled && (
          <div className="bg-[#9D4EDD]/10 border border-[#9D4EDD]/20 rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <h4 className="font-medium text-[#C77DFF] mb-2 text-sm">Auto-Update Enabled</h4>
            <p className="text-xs text-white/70 font-light leading-relaxed">
              The system automatically checks for updates every 30 minutes. When an update is available,
              you will receive an email notification 5 minutes before it is applied. Updates typically
              complete in less than 30 seconds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UpdatesPanel;
