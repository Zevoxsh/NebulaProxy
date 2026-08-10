import { useState, useEffect } from 'react';
import { Activity, Cpu, HardDrive, Zap, Network, AlertCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { adminAPI, domainAPI } from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminBadge,
  AdminAlert,
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
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminMonitoring() {
  const [systemMetrics, setSystemMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cbStatus, setCbStatus] = useState([]);
  const [cbLoading, setCbLoading] = useState(true);
  const [cbResetting, setCbResetting] = useState(null);

  useEffect(() => {
    fetchMetrics();
    fetchCircuitBreakers();

    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchMetrics();
        fetchCircuitBreakers();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchMetrics = async () => {
    try {
      const [metricsRes, logsRes] = await Promise.all([
        adminAPI.getSystemMetrics(),
        adminAPI.getSystemLogs(50)
      ]);

      setSystemMetrics(metricsRes.data.metrics);
      setLogs(logsRes.data.logs);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  };

  const fetchCircuitBreakers = async () => {
    try {
      const res = await domainAPI.getCircuitBreakerStatus();
      const data = res.data?.circuits ?? res.data ?? [];
      setCbStatus(Array.isArray(data) ? data : Object.entries(data).map(([key, v]) => ({ key, ...v })));
    } catch {
      // silently ignore if endpoint not available
    } finally {
      setCbLoading(false);
    }
  };

  const resetCircuitBreaker = async (key) => {
    setCbResetting(key);
    try {
      await domainAPI.resetCircuitBreaker(key);
      await fetchCircuitBreakers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset circuit breaker');
    } finally {
      setCbResetting(null);
    }
  };

  const getCbStateBadge = (state) => {
    switch ((state || '').toUpperCase()) {
      case 'CLOSED':    return <AdminBadge variant="success">CLOSED</AdminBadge>;
      case 'OPEN':      return <AdminBadge variant="danger">OPEN</AdminBadge>;
      case 'HALF_OPEN': return <AdminBadge variant="warning">HALF-OPEN</AdminBadge>;
      default:          return <AdminBadge variant="default">{state || '—'}</AdminBadge>;
    }
  };

  const getLevelBadge = (level) => {
    switch (level) {
      case 'success':
        return <AdminBadge variant="success">Success</AdminBadge>;
      case 'warning':
        return <AdminBadge variant="warning">Warning</AdminBadge>;
      case 'error':
        return <AdminBadge variant="danger">Error</AdminBadge>;
      default:
        return <AdminBadge variant="default">Info</AdminBadge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 bg-admin-border" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">System Monitoring</h1>
          <p className="text-admin-text-muted">Real-time system metrics and logs</p>
        </div>
        <div className="flex items-center gap-3">
          <AdminButton
            variant={autoRefresh ? 'default' : 'secondary'}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </AdminButton>
          <AdminButton variant="secondary" onClick={fetchMetrics}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Now
          </AdminButton>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* System Info */}
      {systemMetrics && (
        <AdminCard>
          <AdminCardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-admin-text-muted">Hostname:</span>
                <span className="ml-2 text-admin-text font-medium">{systemMetrics.hostname}</span>
              </div>
              <div>
                <span className="text-admin-text-muted">Platform:</span>
                <span className="ml-2 text-admin-text font-medium">{systemMetrics.platform}</span>
              </div>
              <div>
                <span className="text-admin-text-muted">Uptime:</span>
                <span className="ml-2 text-admin-text font-medium">{systemMetrics.uptime}</span>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>
      )}

      {/* System Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* CPU Usage */}
        <AdminCard>
          <AdminCardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-admin-primary/10 rounded-lg">
                <Cpu className="w-6 h-6 text-admin-primary" />
              </div>
              <div className="flex-1">
                <div className="text-sm text-admin-text-muted mb-1">CPU Usage</div>
                <div className="text-2xl font-semibold text-admin-text mb-3">
                  {systemMetrics?.cpu || 0}%
                </div>
                <Progress
                  value={systemMetrics?.cpu || 0}
                  className="h-2 bg-admin-border"
                  indicatorClassName="bg-admin-primary"
                />
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Memory Usage */}
        <AdminCard>
          <AdminCardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-admin-warning/10 rounded-lg">
                <HardDrive className="w-6 h-6 text-admin-warning" />
              </div>
              <div className="flex-1">
                <div className="text-sm text-admin-text-muted mb-1">Memory Usage</div>
                <div className="text-2xl font-semibold text-admin-text mb-1">
                  {systemMetrics?.memory?.percentage || 0}%
                </div>
                <div className="text-xs text-admin-text-muted mb-2">
                  {systemMetrics?.memory?.used} / {systemMetrics?.memory?.total}
                </div>
                <Progress
                  value={systemMetrics?.memory?.percentage || 0}
                  className="h-2 bg-admin-border"
                  indicatorClassName="bg-admin-warning"
                />
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Disk Usage */}
        <AdminCard>
          <AdminCardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-admin-success/10 rounded-lg">
                <Zap className="w-6 h-6 text-admin-success" />
              </div>
              <div className="flex-1">
                <div className="text-sm text-admin-text-muted mb-1">Disk Usage</div>
                <div className="text-2xl font-semibold text-admin-text mb-1">
                  {systemMetrics?.disk?.percentage || 0}%
                </div>
                <div className="text-xs text-admin-text-muted mb-2">
                  {systemMetrics?.disk?.used} / {systemMetrics?.disk?.total}
                </div>
                <Progress
                  value={systemMetrics?.disk?.percentage || 0}
                  className="h-2 bg-admin-border"
                  indicatorClassName="bg-admin-success"
                />
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Network I/O */}
        <AdminCard>
          <AdminCardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-admin-primary/10 rounded-lg">
                <Network className="w-6 h-6 text-admin-primary" />
              </div>
              <div className="flex-1">
                <div className="text-sm text-admin-text-muted mb-1">Network I/O</div>
                <div className="text-xl font-semibold text-admin-text mb-1">
                  {systemMetrics?.network?.received || 'N/A'}
                </div>
                <div className="text-xs text-admin-text-muted">Received</div>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>
      </div>

      {/* Real-Time Traffic Logs - DISABLED */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center gap-3">
            <AdminCardTitle>Real-Time Traffic Logs</AdminCardTitle>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 bg-admin-warning rounded-full animate-pulse"></span>
              <span className="text-admin-warning">Disabled</span>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <div className="rounded-lg border border-admin-border overflow-hidden max-h-96 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-admin-surface2">
                <TableRow className="border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold w-32">Time</TableHead>
                  <TableHead className="text-admin-text font-semibold w-20">Protocol</TableHead>
                  <TableHead className="text-admin-text font-semibold w-20">Level</TableHead>
                  <TableHead className="text-admin-text font-semibold">Domain</TableHead>
                  <TableHead className="text-admin-text font-semibold">Path</TableHead>
                  <TableHead className="text-admin-text font-semibold w-20">Status</TableHead>
                  <TableHead className="text-admin-text font-semibold w-24">Response</TableHead>
                  <TableHead className="text-admin-text font-semibold">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-admin-text-muted py-12">
                    Real-time traffic logs are currently disabled
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </AdminCardContent>
      </AdminCard>

      {/* Circuit Breaker Status */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-admin-primary" />
              <AdminCardTitle>Circuit Breakers</AdminCardTitle>
            </div>
            <AdminButton variant="secondary" size="sm" onClick={fetchCircuitBreakers}>
              <RefreshCw className="w-3 h-3 mr-1" />
              Refresh
            </AdminButton>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          {cbLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 bg-admin-border" />)}
            </div>
          ) : cbStatus.length === 0 ? (
            <p className="text-admin-text-muted text-sm text-center py-8">No circuit breakers active</p>
          ) : (
            <div className="rounded-lg border border-admin-border overflow-hidden">
              <Table>
                <TableHeader className="bg-admin-surface2">
                  <TableRow className="border-admin-border hover:bg-admin-surface2">
                    <TableHead className="text-admin-text font-semibold">Backend Key</TableHead>
                    <TableHead className="text-admin-text font-semibold w-32">State</TableHead>
                    <TableHead className="text-admin-text font-semibold w-28">Failures</TableHead>
                    <TableHead className="text-admin-text font-semibold w-48">Opened At</TableHead>
                    <TableHead className="text-admin-text font-semibold w-28">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cbStatus.map((cb) => (
                    <TableRow key={cb.key} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell>
                        <code className="text-admin-primary text-xs bg-admin-bg px-2 py-1 rounded">{cb.key}</code>
                      </TableCell>
                      <TableCell>{getCbStateBadge(cb.state)}</TableCell>
                      <TableCell className="text-admin-text">{cb.failures ?? cb.failureCount ?? '—'}</TableCell>
                      <TableCell className="text-admin-text-muted text-xs font-mono">
                        {cb.openedAt ? new Date(cb.openedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <AdminButton
                          variant="secondary"
                          size="sm"
                          disabled={cbResetting === cb.key || (cb.state || '').toUpperCase() === 'CLOSED'}
                          onClick={() => resetCircuitBreaker(cb.key)}
                        >
                          {cbResetting === cb.key ? (
                            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3 mr-1" />
                          )}
                          Reset
                        </AdminButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminCardContent>
      </AdminCard>

      {/* System Logs */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between">
            <AdminCardTitle>System Logs</AdminCardTitle>
            <span className="text-xs text-admin-text-muted">{logs.length} entries</span>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">Timestamp</TableHead>
                  <TableHead className="text-admin-text font-semibold">Level</TableHead>
                  <TableHead className="text-admin-text font-semibold">Source</TableHead>
                  <TableHead className="text-admin-text font-semibold">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-admin-text-muted py-12">
                      No logs available
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log, idx) => (
                    <TableRow key={idx} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell className="text-admin-text-muted font-mono text-xs">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>{getLevelBadge(log.level)}</TableCell>
                      <TableCell>
                        <code className="text-admin-primary text-sm bg-admin-bg px-2 py-1 rounded">
                          {log.source}
                        </code>
                      </TableCell>
                      <TableCell className="text-admin-text max-w-2xl truncate">
                        {log.message}
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

