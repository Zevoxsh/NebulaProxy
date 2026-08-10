import { useState, useEffect } from 'react';
import { Mail, Activity, RefreshCw, Server, AlertCircle, Clock, Database } from 'lucide-react';
import { smtpProxyAPI, adminAPI } from '../../api/client';
import {
  AdminStatCard,
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminBadge,
  AdminAlert,
  AdminAlertDescription
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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

export default function AdminSmtpProxy() {
  const SMTP_PROXY_DEFAULTS = {
    SMTP_PROXY_ENABLED: 'false',
    SMTP_PROXY_BIND_ADDRESS: '0.0.0.0',
    SMTP_PROXY_BACKEND_HOST: '',
    SMTP_PROXY_BACKEND_PORT: '25',
    SMTP_PROXY_PORT: '25',
    SMTP_PROXY_SUBMISSION_PORT: '587',
    SMTP_PROXY_SMTPS_PORT: '465',
    SMTP_PROXY_IDLE_TIMEOUT_MS: '300000',
    SMTP_PROXY_CONNECT_TIMEOUT_MS: '10000',
    SMTP_PROXY_LOGGING_ENABLED: 'true'
  };

  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [relayConfig, setRelayConfig] = useState(SMTP_PROXY_DEFAULTS);
  const [fullConfig, setFullConfig] = useState({});
  const [configSaving, setConfigSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { toast } = useToast();

  const [pagination, setPagination] = useState({
    limit: 50,
    offset: 0,
    hasMore: false
  });

  useEffect(() => {
    fetchAll();

    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchStats();
        fetchSummary();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([
      fetchRelayConfig(),
      fetchStats(),
      fetchSummary(),
      fetchLogs()
    ]);
    setLoading(false);
  };

  const fetchStats = async () => {
    try {
      const response = await smtpProxyAPI.getStats();
      setStats(response.data.stats);
    } catch (err) {
      console.error('Failed to fetch SMTP stats:', err);
    }
  };

  const fetchSummary = async () => {
    try {
      const response = await smtpProxyAPI.getSummary();
      setSummary(response.data);
    } catch (err) {
      console.error('Failed to fetch SMTP summary:', err);
    }
  };

  const fetchLogs = async (offset = 0) => {
    try {
      const response = await smtpProxyAPI.getLogs({
        limit: pagination.limit,
        offset
      });
      setLogs(response.data.logs);
      setPagination({
        limit: response.data.pagination.limit,
        offset: response.data.pagination.offset,
        hasMore: response.data.pagination.hasMore
      });
    } catch (err) {
      console.error('Failed to fetch SMTP logs:', err);
    }
  };

  const fetchRelayConfig = async () => {
    try {
      const response = await adminAPI.getConfig();
      const mergedConfig = {};
      (response.data.sections || []).forEach((section) => {
        section.variables.forEach((variable) => {
          mergedConfig[variable.key] = variable.value ?? '';
        });
      });

      setFullConfig(mergedConfig);
      setRelayConfig({
        SMTP_PROXY_ENABLED: String(mergedConfig.SMTP_PROXY_ENABLED ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_ENABLED),
        SMTP_PROXY_BIND_ADDRESS: String(mergedConfig.SMTP_PROXY_BIND_ADDRESS ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_BIND_ADDRESS),
        SMTP_PROXY_BACKEND_HOST: String(mergedConfig.SMTP_PROXY_BACKEND_HOST ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_BACKEND_HOST),
        SMTP_PROXY_BACKEND_PORT: String(mergedConfig.SMTP_PROXY_BACKEND_PORT ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_BACKEND_PORT),
        SMTP_PROXY_PORT: String(mergedConfig.SMTP_PROXY_PORT ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_PORT),
        SMTP_PROXY_SUBMISSION_PORT: String(mergedConfig.SMTP_PROXY_SUBMISSION_PORT ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_SUBMISSION_PORT),
        SMTP_PROXY_SMTPS_PORT: String(mergedConfig.SMTP_PROXY_SMTPS_PORT ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_SMTPS_PORT),
        SMTP_PROXY_IDLE_TIMEOUT_MS: String(mergedConfig.SMTP_PROXY_IDLE_TIMEOUT_MS ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_IDLE_TIMEOUT_MS),
        SMTP_PROXY_CONNECT_TIMEOUT_MS: String(mergedConfig.SMTP_PROXY_CONNECT_TIMEOUT_MS ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_CONNECT_TIMEOUT_MS),
        SMTP_PROXY_LOGGING_ENABLED: String(mergedConfig.SMTP_PROXY_LOGGING_ENABLED ?? SMTP_PROXY_DEFAULTS.SMTP_PROXY_LOGGING_ENABLED)
      });
    } catch (err) {
      console.error('Failed to fetch SMTP relay configuration:', err);
    }
  };

  const updateRelayField = (key, value) => {
    setRelayConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveRelayConfig = async () => {
    try {
      setConfigSaving(true);
      setError('');
      const payload = {
        ...fullConfig,
        ...relayConfig
      };

      const validation = await adminAPI.validateConfig(payload);
      if (!validation.data.valid) {
        const firstError = validation.data.errors?.[0] || 'SMTP relay configuration validation failed';
        throw new Error(firstError);
      }

      await adminAPI.updateConfig(payload);
      toast({
        title: 'Configuration Saved',
        description: 'SMTP relay configuration saved. Restart SMTP Proxy to apply changes.'
      });
      await fetchRelayConfig();
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Failed to save SMTP relay configuration';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setConfigSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setError('');
    try {
      await smtpProxyAPI.restart();
      toast({
        title: 'Success',
        description: 'SMTP Proxy service restarted successfully'
      });
      await fetchAll();
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to restart SMTP Proxy service';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setRestarting(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getEventTypeBadge = (eventType) => {
    if (eventType.includes('connected')) {
      return <AdminBadge variant="default">{eventType}</AdminBadge>;
    } else if (eventType.includes('closed')) {
      return <AdminBadge variant="secondary">{eventType}</AdminBadge>;
    }
    return <AdminBadge variant="default">{eventType}</AdminBadge>;
  };

  const getStatusBadge = (status) => {
    if (status === 'completed') {
      return <AdminBadge variant="success">Completed</AdminBadge>;
    } else if (status === 'failed') {
      return <AdminBadge variant="danger">Failed</AdminBadge>;
    } else if (status === 'active') {
      return <AdminBadge variant="warning">Active</AdminBadge>;
    }
    return <AdminBadge variant="secondary">{status}</AdminBadge>;
  };

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
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
          <h1 className="text-3xl font-semibold text-admin-text mb-2">SMTP Proxy</h1>
          <p className="text-admin-text-muted">Monitor SMTP relay activity with PROXY Protocol v2</p>
        </div>
        <div className="flex items-center gap-3">
          <AdminButton
            variant={autoRefresh ? 'default' : 'secondary'}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </AdminButton>
          <AdminButton
            variant="secondary"
            onClick={fetchAll}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </AdminButton>
          <AdminButton
            onClick={handleRestart}
            disabled={restarting}
          >
            <Server className="w-4 h-4 mr-2" />
            {restarting ? 'Restarting...' : 'Restart'}
          </AdminButton>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Stats Grid */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between w-full">
            <div>
              <AdminCardTitle>Relay Configuration</AdminCardTitle>
              <p className="text-xs text-admin-text-muted mt-1">
                SMTP relay settings are managed here.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AdminButton variant="secondary" onClick={fetchRelayConfig}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload
              </AdminButton>
              <AdminButton onClick={handleSaveRelayConfig} disabled={configSaving}>
                {configSaving ? 'Saving...' : 'Save Configuration'}
              </AdminButton>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label className="text-admin-text">Relay Enabled</Label>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-admin-border bg-admin-bg">
                <Checkbox
                  checked={relayConfig.SMTP_PROXY_ENABLED === 'true'}
                  onCheckedChange={(checked) => updateRelayField('SMTP_PROXY_ENABLED', checked ? 'true' : 'false')}
                  className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
                />
                <span className="text-sm text-admin-text">Enable SMTP proxy relay</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Bind Address</Label>
              <Input
                value={relayConfig.SMTP_PROXY_BIND_ADDRESS}
                onChange={(e) => updateRelayField('SMTP_PROXY_BIND_ADDRESS', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                placeholder="0.0.0.0"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Backend Host</Label>
              <Input
                value={relayConfig.SMTP_PROXY_BACKEND_HOST}
                onChange={(e) => updateRelayField('SMTP_PROXY_BACKEND_HOST', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                placeholder="mail.example.com"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Backend Port</Label>
              <Input
                type="number"
                value={relayConfig.SMTP_PROXY_BACKEND_PORT}
                onChange={(e) => updateRelayField('SMTP_PROXY_BACKEND_PORT', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                min="1"
                max="65535"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">SMTP Port</Label>
              <Input
                type="number"
                value={relayConfig.SMTP_PROXY_PORT}
                onChange={(e) => updateRelayField('SMTP_PROXY_PORT', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                min="0"
                max="65535"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Submission Port</Label>
              <Input
                type="number"
                value={relayConfig.SMTP_PROXY_SUBMISSION_PORT}
                onChange={(e) => updateRelayField('SMTP_PROXY_SUBMISSION_PORT', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                min="0"
                max="65535"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">SMTPS Port</Label>
              <Input
                type="number"
                value={relayConfig.SMTP_PROXY_SMTPS_PORT}
                onChange={(e) => updateRelayField('SMTP_PROXY_SMTPS_PORT', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                min="0"
                max="65535"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Idle Timeout (ms)</Label>
              <Input
                type="number"
                value={relayConfig.SMTP_PROXY_IDLE_TIMEOUT_MS}
                onChange={(e) => updateRelayField('SMTP_PROXY_IDLE_TIMEOUT_MS', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                min="1000"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Connect Timeout (ms)</Label>
              <Input
                type="number"
                value={relayConfig.SMTP_PROXY_CONNECT_TIMEOUT_MS}
                onChange={(e) => updateRelayField('SMTP_PROXY_CONNECT_TIMEOUT_MS', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                min="1000"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Relay Logging</Label>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-admin-border bg-admin-bg">
                <Checkbox
                  checked={relayConfig.SMTP_PROXY_LOGGING_ENABLED === 'true'}
                  onCheckedChange={(checked) => updateRelayField('SMTP_PROXY_LOGGING_ENABLED', checked ? 'true' : 'false')}
                  className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
                />
                <span className="text-sm text-admin-text">Store SMTP relay logs</span>
              </div>
            </div>
          </div>
        </AdminCardContent>
      </AdminCard>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <AdminStatCard
          title="Service Status"
          value={stats?.isRunning ? 'Running' : 'Stopped'}
          subtitle={`${stats?.servers?.length || 0} ports listening`}
          icon={Activity}
        />
        <AdminStatCard
          title="Active Connections"
          value={stats?.activeConnections || 0}
          subtitle={`${stats?.totalConnections || 0} total`}
          icon={Mail}
        />
        <AdminStatCard
          title="Data Transferred"
          value={formatBytes(stats?.totalBytes || 0)}
          subtitle="All time"
          icon={Database}
        />
        <AdminStatCard
          title="Errors"
          value={stats?.errors || 0}
          subtitle="Connection errors"
          icon={AlertCircle}
        />
      </div>

      {/* Listening Ports */}
      {stats?.servers && stats.servers.length > 0 && (
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>Listening Ports</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {stats.servers.map((server, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-admin-bg rounded-lg border border-admin-border">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-admin-primary/10">
                    <Server className="w-5 h-5 text-admin-primary" />
                  </div>
                  <div>
                    <div className="text-admin-text font-medium">{server.name}</div>
                    <div className="text-sm text-admin-text-muted">Port {server.port}</div>
                  </div>
                </div>
              ))}
            </div>
          </AdminCardContent>
        </AdminCard>
      )}

      {/* 24h Summary */}
      {summary && (
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>Last 24 Hours</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-6">
              <div>
                <div className="text-admin-text-muted text-sm mb-1">Connections</div>
                <div className="text-3xl font-semibold text-admin-text">
                  {summary.summary?.totalConnections || 0}
                </div>
              </div>
              <div>
                <div className="text-admin-text-muted text-sm mb-1">Unique IPs</div>
                <div className="text-3xl font-semibold text-admin-text">
                  {summary.summary?.uniqueIps || 0}
                </div>
              </div>
              <div>
                <div className="text-admin-text-muted text-sm mb-1">Successful</div>
                <div className="text-3xl font-semibold text-admin-success">
                  {summary.summary?.successful || 0}
                </div>
              </div>
              <div>
                <div className="text-admin-text-muted text-sm mb-1">Failed</div>
                <div className="text-3xl font-semibold text-admin-danger">
                  {summary.summary?.failed || 0}
                </div>
              </div>
              <div>
                <div className="text-admin-text-muted text-sm mb-1">Data Transfer</div>
                <div className="text-3xl font-semibold text-admin-text">
                  {formatBytes(summary.summary?.totalBytes || 0)}
                </div>
              </div>
            </div>

            {/* Top IPs */}
            {summary.topIps && summary.topIps.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-admin-text mb-3">Top Client IPs</h3>
                <div className="space-y-2">
                  {summary.topIps.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-admin-bg rounded border border-admin-border">
                      <span className="text-admin-text text-sm font-mono">{item.ip}</span>
                      <span className="text-admin-text-muted text-sm">{item.count} connections</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AdminCardContent>
        </AdminCard>
      )}

      {/* Recent Logs */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Recent Connections</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-admin-text-muted">
              No connection logs yet
            </div>
          ) : (
            <>
              <Table>
                  <TableHeader>
                    <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                      <TableHead className="text-admin-text font-semibold">Timestamp</TableHead>
                      <TableHead className="text-admin-text font-semibold">Client IP</TableHead>
                      <TableHead className="text-admin-text font-semibold">Event Type</TableHead>
                      <TableHead className="text-admin-text font-semibold">Status</TableHead>
                      <TableHead className="text-admin-text font-semibold">Data Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                        <TableCell className="text-admin-text">
                          <div className="flex items-center gap-2 text-xs">
                            <Clock className="w-3.5 h-3.5 text-admin-text-muted" />
                            {formatDate(log.timestamp)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-admin-text">{log.client_ip}</TableCell>
                        <TableCell>{getEventTypeBadge(log.event_type)}</TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                        <TableCell className="text-sm text-admin-text-muted">
                          {log.message_size ? formatBytes(log.message_size) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <AdminButton
                  variant="secondary"
                  onClick={() => fetchLogs(Math.max(0, pagination.offset - pagination.limit))}
                  disabled={pagination.offset === 0}
                >
                  Previous
                </AdminButton>
                <span className="text-sm text-admin-text-muted">
                  Showing {pagination.offset + 1} - {pagination.offset + logs.length}
                </span>
                <AdminButton
                  variant="secondary"
                  onClick={() => fetchLogs(pagination.offset + pagination.limit)}
                  disabled={!pagination.hasMore}
                >
                  Next
                </AdminButton>
              </div>
            </>
          )}
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}

