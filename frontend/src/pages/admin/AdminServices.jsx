import { useState, useEffect, useRef, useCallback } from 'react';
import { Server, Play, Square, RotateCw, AlertCircle, CheckCircle2, Clock, RefreshCw, Terminal, ChevronDown } from 'lucide-react';
import { adminAPI } from '../../api/client';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export default function AdminServices() {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logsModal, setLogsModal] = useState(false);
  const [logsContainer, setLogsContainer] = useState(null);
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLines, setLogsLines] = useState(200);
  const logsEndRef = useRef(null);
  const logsIntervalRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchContainers();
  }, []);

  const scrollLogsToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchLogs = useCallback(async (containerName, lines) => {
    try {
      const response = await adminAPI.getContainerLogs(containerName, lines);
      setLogs(response.data.logs || '');
      setTimeout(scrollLogsToBottom, 50);
    } catch (err) {
      setLogs(`Error fetching logs: ${err.response?.data?.message || err.message}`);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const openLogs = (container) => {
    setLogsContainer(container);
    setLogsLines(200);
    setLogs('');
    setLogsLoading(true);
    setLogsModal(true);
    fetchLogs(container.name, 200);
    // Poll every 3s to simulate docker logs -f
    logsIntervalRef.current = setInterval(() => {
      fetchLogs(container.name, 200);
    }, 3000);
  };

  const closeLogs = () => {
    setLogsModal(false);
    setLogsContainer(null);
    setLogs('');
    if (logsIntervalRef.current) {
      clearInterval(logsIntervalRef.current);
      logsIntervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (logsIntervalRef.current) clearInterval(logsIntervalRef.current);
    };
  }, []);

  const fetchContainers = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.listContainers();
      setContainers(response.data.containers);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load containers');
    } finally {
      setLoading(false);
    }
  };

  const handleServiceAction = async (container, action) => {
    setError('');

    try {
      let result;
      switch (action) {
        case 'start':
          result = await adminAPI.startContainer(container.name);
          break;
        case 'stop':
          result = await adminAPI.stopContainer(container.name);
          break;
        case 'restart':
          result = await adminAPI.restartContainer(container.name);
          break;
        default:
          return;
      }

      toast({
        title: 'Success',
        description: result.data.message || `Action ${action} completed`
      });
      await fetchContainers();
    } catch (err) {
      const errorMsg = err.response?.data?.message || `Failed to ${action} container`;
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const getStatusBadge = (status) => {
    switch (status.toLowerCase()) {
      case 'running':
        return (
          <AdminBadge variant="success" className="flex items-center gap-1 w-fit">
            <CheckCircle2 className="w-3 h-3" />
            Running
          </AdminBadge>
        );
      case 'exited':
        return (
          <AdminBadge variant="danger" className="flex items-center gap-1 w-fit">
            <Square className="w-3 h-3" />
            Stopped
          </AdminBadge>
        );
      case 'paused':
        return (
          <AdminBadge variant="warning" className="flex items-center gap-1 w-fit">
            <Clock className="w-3 h-3" />
            Paused
          </AdminBadge>
        );
      default:
        return <AdminBadge variant="secondary">{status}</AdminBadge>;
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
        <Skeleton className="h-96 bg-admin-border" />
      </div>
    );
  }

  const runningCount = containers.filter(c => c.status === 'running').length;
  const stoppedCount = containers.filter(c => c.status === 'exited').length;

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">Services</h1>
          <p className="text-admin-text-muted">Manage Docker containers and services</p>
        </div>
        <AdminButton variant="secondary" onClick={fetchContainers}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </AdminButton>
      </div>

      {/* Error Message */}
      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Service Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AdminStatCard
          title="Running"
          value={runningCount}
          icon={CheckCircle2}
        />
        <AdminStatCard
          title="Total Containers"
          value={containers.length}
          icon={Server}
        />
        <AdminStatCard
          title="Stopped"
          value={stoppedCount}
          icon={AlertCircle}
        />
      </div>

      {/* Services Table */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Docker Containers</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">Container</TableHead>
                  <TableHead className="text-admin-text font-semibold">Image</TableHead>
                  <TableHead className="text-admin-text font-semibold">Status</TableHead>
                  <TableHead className="text-admin-text font-semibold">Uptime</TableHead>
                  <TableHead className="text-admin-text font-semibold">Ports</TableHead>
                  <TableHead className="text-admin-text font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-admin-text-muted py-12">
                      No containers found
                    </TableCell>
                  </TableRow>
                ) : (
                  containers.map((container) => (
                    <TableRow key={container.id} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell className="text-admin-text">
                        <div className="flex items-center gap-3">
                          <Server className="w-5 h-5 text-admin-primary" />
                          <span className="font-medium">{container.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-admin-text-muted text-sm">{container.image}</TableCell>
                      <TableCell>{getStatusBadge(container.status)}</TableCell>
                      <TableCell className="text-admin-text-muted">{container.uptime}</TableCell>
                      <TableCell className="text-admin-text-muted font-mono text-sm">
                        {container.ports || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => openLogs(container)}
                            title="View logs"
                            className="text-admin-text-muted hover:text-admin-primary"
                          >
                            <Terminal className="w-4 h-4" />
                          </AdminButton>
                          {container.status === 'running' ? (
                            <>
                              <AdminButton
                                variant="ghost"
                                size="icon"
                                onClick={() => handleServiceAction(container, 'restart')}
                                title="Restart"
                              >
                                <RotateCw className="w-4 h-4" />
                              </AdminButton>
                              <AdminButton
                                variant="ghost"
                                size="icon"
                                onClick={() => handleServiceAction(container, 'stop')}
                                title="Stop"
                                className="text-admin-danger hover:text-admin-danger"
                              >
                                <Square className="w-4 h-4" />
                              </AdminButton>
                            </>
                          ) : (
                            <AdminButton
                              variant="ghost"
                              size="icon"
                              onClick={() => handleServiceAction(container, 'start')}
                              title="Start"
                              className="text-admin-success hover:text-admin-success"
                            >
                              <Play className="w-4 h-4" />
                            </AdminButton>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </AdminCardContent>
      </AdminCard>

      {/* Logs Modal */}
      <Dialog open={logsModal} onOpenChange={(open) => { if (!open) closeLogs(); }}>
        <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col p-0 gap-0 bg-[#0d1117] border border-[#30363d]" data-admin-theme>
          <DialogHeader className="px-4 py-3 border-b border-[#30363d] flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-[#e6edf3] font-mono text-sm">
              <Terminal className="w-4 h-4 text-green-400" />
              <span className="text-green-400">logs -f</span>
              <span className="text-[#e6edf3]">{logsContainer?.name}</span>
              <span className="ml-auto flex items-center gap-1 text-xs text-[#8b949e] font-sans">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
                live
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto bg-[#0d1117] p-4 font-mono text-xs leading-relaxed">
            {logsLoading ? (
              <div className="flex items-center gap-2 text-[#8b949e]">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Loading logs...
              </div>
            ) : logs ? (
              <pre className="whitespace-pre-wrap break-all text-[#e6edf3]">{logs}</pre>
            ) : (
              <span className="text-[#8b949e]">No logs available.</span>
            )}
            <div ref={logsEndRef} />
          </div>
          <div className="px-4 py-2 border-t border-[#30363d] flex items-center justify-between flex-shrink-0">
            <span className="text-xs text-[#8b949e] font-mono">
              Rafraîchissement toutes les 3s · {logsLines} dernières lignes
            </span>
            <button
              onClick={scrollLogsToBottom}
              className="flex items-center gap-1 text-xs text-[#8b949e] hover:text-[#e6edf3] transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              Bas
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

