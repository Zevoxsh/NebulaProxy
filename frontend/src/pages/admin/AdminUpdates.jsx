import { useState, useEffect } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, Clock, GitBranch } from 'lucide-react';
import api from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminBadge,
  AdminAlert,
  AdminAlertTitle,
  AdminAlertDescription
} from '@/components/admin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export default function AdminUpdates() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const { toast } = useToast();

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
      if (!silent) setError(null);
    } catch (err) {
      if (!applying && !silent) {
        setError(err.response?.data?.error || 'Failed to load update data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Check for updates manually
  const handleCheckForUpdates = async () => {
    setChecking(true);
    setError(null);
    try {
      await api.post('/admin/updates/check');
      const [statusRes, historyRes] = await Promise.all([
        api.get('/admin/updates/status'),
        api.get('/admin/updates/history')
      ]);

      const freshStatus = statusRes.data.data;
      const freshHistory = historyRes.data.data;

      setStatus(freshStatus);
      setHistory(freshHistory);

      if (freshStatus?.updateAvailable) {
        toast({
          title: 'Update Available!',
          description: `Current: ${freshStatus.currentCommit?.substring(0, 8)} → New: ${freshStatus.remoteCommit?.substring(0, 8)}`
        });
      } else {
        toast({
          title: 'No Updates Available',
          description: 'You are running the latest version.'
        });
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Failed to check for updates';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
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
      toast({
        title: 'Update Started',
        description: 'This page will refresh automatically when complete.'
      });

      const pollInterval = setInterval(async () => {
        try {
          const res = await api.get('/admin/updates/status');
          if (!res.data.data.updateInProgress) {
            clearInterval(pollInterval);
            await loadData(true);
            setApplying(false);
            toast({
              title: 'Update Completed',
              description: 'System updated successfully!'
            });
          }
        } catch (err) {
          // Server is restarting, keep polling silently
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setApplying(false);
      }, 300000);
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Failed to apply update';
      setError(errorMsg);
      setApplying(false);
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: errorMsg
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 bg-admin-border" />
          ))}
        </div>
        <Skeleton className="h-64 bg-admin-border" />
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">System Updates</h1>
          <p className="text-admin-text-muted">Manage system updates and version history</p>
        </div>
        <div className="flex items-center gap-3">
          <AdminButton
            variant="secondary"
            onClick={handleCheckForUpdates}
            disabled={checking || applying}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking...' : 'Check for Updates'}
          </AdminButton>
          {status?.updateAvailable && (
            <AdminButton
              onClick={handleApplyUpdate}
              disabled={applying}
            >
              <Download className="w-4 h-4 mr-2" />
              {applying ? 'Applying...' : 'Apply Update Now'}
            </AdminButton>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Current Version */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AdminCard>
          <AdminCardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <GitBranch className="w-5 h-5 text-admin-primary" />
              <span className="text-sm text-admin-text-muted">Current Version</span>
            </div>
            <div className="font-mono text-lg font-semibold text-admin-text">
              {status?.currentCommit?.substring(0, 8) || 'Unknown'}
            </div>
          </AdminCardContent>
        </AdminCard>

        <AdminCard>
          <AdminCardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-admin-success" />
              <span className="text-sm text-admin-text-muted">Last Checked</span>
            </div>
            <div className="text-lg font-semibold text-admin-text">
              {status?.lastChecked ? new Date(status.lastChecked).toLocaleString() : 'Never'}
            </div>
          </AdminCardContent>
        </AdminCard>

        <AdminCard>
          <AdminCardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              {status?.updateAvailable ? (
                <>
                  <AlertCircle className="w-5 h-5 text-admin-warning" />
                  <span className="text-sm text-admin-text-muted">Update Status</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 text-admin-success" />
                  <span className="text-sm text-admin-text-muted">Update Status</span>
                </>
              )}
            </div>
            <div className="text-lg font-semibold">
              {status?.updateAvailable ? (
                <span className="text-admin-warning">Update Available</span>
              ) : (
                <span className="text-admin-success">Up to Date</span>
              )}
            </div>
          </AdminCardContent>
        </AdminCard>
      </div>

      {/* Update Available Alert */}
      {status?.updateAvailable && (
        <AdminAlert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <div>
            <AdminAlertTitle>New Update Available</AdminAlertTitle>
            <AdminAlertDescription>
              A new version is available: <span className="font-mono bg-admin-bg px-1.5 py-0.5 rounded">{status.remoteCommit?.substring(0, 8)}</span>
            </AdminAlertDescription>
          </div>
        </AdminAlert>
      )}

      {/* Update History */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Update History</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">Date</TableHead>
                  <TableHead className="text-admin-text font-semibold">Version</TableHead>
                  <TableHead className="text-admin-text font-semibold">Status</TableHead>
                  <TableHead className="text-admin-text font-semibold">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-admin-text-muted py-12">
                      No update history available
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((item, idx) => (
                    <TableRow key={idx} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell className="text-admin-text-muted">
                        {item.started_at ? new Date(item.started_at).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono bg-admin-bg px-2 py-1 rounded text-admin-text text-sm">
                          {item.to_commit || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item.update_status === 'success' ? (
                          <AdminBadge variant="success" className="flex items-center gap-1 w-fit">
                            <CheckCircle className="w-3 h-3" />
                            Success
                          </AdminBadge>
                        ) : item.update_status === 'failed' || item.update_status === 'rolled_back' ? (
                          <AdminBadge variant="danger" className="flex items-center gap-1 w-fit">
                            <AlertCircle className="w-3 h-3" />
                            Failed
                          </AdminBadge>
                        ) : (
                          <AdminBadge variant="default" className="flex items-center gap-1 w-fit">
                            <Clock className="w-3 h-3" />
                            In Progress
                          </AdminBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-admin-text-muted">
                        {item.downtime_seconds ? `${item.downtime_seconds}s` : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}

