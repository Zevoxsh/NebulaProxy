import { useState, useEffect } from 'react';
import { Shield, Filter, Download, RefreshCw, Search, Calendar } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminBadge
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    user: '',
    action: '',
    startDate: '',
    endDate: '',
    limit: 100
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchLogs();
  }, [page, filters]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getAuditLogs({
        ...filters,
        page,
        limit: filters.limit
      });
      setLogs(response.data.logs || []);
      setTotalPages(response.data.totalPages || 1);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const exportLogs = async () => {
    try {
      const response = await adminAPI.getAuditLogs({
        ...filters,
        export: true,
        limit: 10000
      });
      const blob = new Blob([JSON.stringify(response.data.logs, null, 2)], {
        type: 'application/json'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString()}.json`;
      a.click();
    } catch (err) {
      console.error('Failed to export logs:', err);
    }
  };

  const getActionBadge = (action) => {
    if (action.includes('create')) return 'success';
    if (action.includes('delete')) return 'danger';
    if (action.includes('update')) return 'warning';
    return 'default';
  };

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">Audit Trail</h1>
          <p className="text-admin-text-muted">Complete activity log of all admin and user actions</p>
        </div>
        <div className="flex items-center gap-3">
          <AdminButton variant="secondary" onClick={exportLogs}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </AdminButton>
          <AdminButton variant="secondary" onClick={fetchLogs}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </AdminButton>
        </div>
      </div>

      {/* Filters */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between">
            <AdminCardTitle>Filters</AdminCardTitle>
            <Filter className="w-5 h-5 text-admin-text-muted" />
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label className="text-admin-text">User</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
                <Input
                  type="text"
                  value={filters.user}
                  onChange={(e) => handleFilterChange('user', e.target.value)}
                  placeholder="Username..."
                  className="pl-10 bg-admin-bg border-admin-border text-admin-text"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Action Type</Label>
              <Combobox
                value={filters.action}
                onValueChange={(value) => handleFilterChange('action', value)}
                options={[
                  { value: '', label: 'All Actions' },
                  { value: 'create', label: 'Create' },
                  { value: 'update', label: 'Update' },
                  { value: 'delete', label: 'Delete' },
                  { value: 'login', label: 'Login' },
                  { value: 'logout', label: 'Logout' },
                ]}
                placeholder="All Actions"
                searchPlaceholder="Search action..."
                emptyText="No action found."
                triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Start Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
                <Input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className="pl-10 bg-admin-bg border-admin-border text-admin-text"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">End Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
                <Input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className="pl-10 bg-admin-bg border-admin-border text-admin-text"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Limit</Label>
              <Combobox
                value={filters.limit.toString()}
                onValueChange={(value) => handleFilterChange('limit', parseInt(value, 10))}
                options={[
                  { value: '50', label: '50' },
                  { value: '100', label: '100' },
                  { value: '250', label: '250' },
                  { value: '500', label: '500' },
                ]}
                placeholder="Limit"
                searchPlaceholder="Search limit..."
                emptyText="No limit found."
                triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
              />
            </div>
          </div>
        </AdminCardContent>
      </AdminCard>

      {/* Audit Logs Table */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between">
            <AdminCardTitle>Activity Logs</AdminCardTitle>
            <Shield className="w-5 h-5 text-admin-text-muted" />
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full bg-admin-border" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-admin-text-muted">No audit logs found</div>
          ) : (
            <>
              <Table>
                  <TableHeader>
                    <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                      <TableHead className="text-admin-text font-semibold">Timestamp</TableHead>
                      <TableHead className="text-admin-text font-semibold">User</TableHead>
                      <TableHead className="text-admin-text font-semibold">Action</TableHead>
                      <TableHead className="text-admin-text font-semibold">Resource</TableHead>
                      <TableHead className="text-admin-text font-semibold">Details</TableHead>
                      <TableHead className="text-admin-text font-semibold">IP Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log, idx) => (
                      <TableRow key={idx} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                        <TableCell className="text-admin-text whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-admin-text font-medium">
                          {log.username || 'System'}
                        </TableCell>
                        <TableCell className="text-admin-text">
                          <AdminBadge variant={getActionBadge(log.action)}>
                            {log.action}
                          </AdminBadge>
                        </TableCell>
                        <TableCell className="text-admin-text-muted">
                          {log.resource_type}
                          {log.resource_id && (
                            <span className="text-admin-text-subtle"> #{log.resource_id}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-admin-text-muted text-xs max-w-md truncate">
                          {log.details || '-'}
                        </TableCell>
                        <TableCell className="text-admin-text-subtle font-mono text-xs">
                          {log.ip_address || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-admin-text-muted">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <AdminButton
                      variant="secondary"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </AdminButton>
                    <AdminButton
                      variant="secondary"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </AdminButton>
                  </div>
                </div>
              )}
            </>
          )}
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}

