import { useState, useEffect } from 'react';
import { Globe, Search, Shield, AlertCircle, CheckCircle, XCircle, Clock, Edit, Trash2, Power, Users } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminBadge,
  AdminAlert,
  AdminAlertDescription,
  AdminStatCard
} from '@/components/admin';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function AdminDomains() {
  const [domains, setDomains] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [editingDomain, setEditingDomain] = useState(null);
  const [editForm, setEditForm] = useState({
    hostname: '',
    backend_url: '',
    backend_port: '',
    external_port: '',
    proxy_type: 'http',
    user_id: '',
    team_id: '',
    ssl_enabled: false,
    ssl_force_redirect: false,
    is_active: true,
    description: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { toast } = useToast();

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      const [domainsRes, usersRes, teamsRes] = await Promise.all([
        adminAPI.getAllDomains(),
        adminAPI.listUsers(),
        adminAPI.getAllTeams()
      ]);
      setDomains(domainsRes.data.domains);
      setUsers(usersRes.data.users || []);
      setTeams(teamsRes.data.teams || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchDomains = async () => {
    try {
      const response = await adminAPI.getAllDomains();
      setDomains(response.data.domains);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load domains');
    }
  };

  const openEditModal = (domain) => {
    setEditingDomain(domain);
    setEditForm({
      hostname: domain.hostname || '',
      backend_url: domain.backend_url || '',
      backend_port: domain.backend_port || '',
      external_port: domain.external_port || '',
      proxy_type: domain.proxy_type || 'http',
      user_id: domain.user_id || '',
      team_id: domain.team_id || '',
      ssl_enabled: domain.ssl_enabled || false,
      ssl_force_redirect: domain.ssl_force_redirect || false,
      is_active: domain.is_active !== undefined ? domain.is_active : true,
      description: domain.description || ''
    });
  };

  const closeEditModal = () => {
    setEditingDomain(null);
    setError('');
  };

  const handleUpdateDomain = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      // Convert form data to API format (camelCase)
      const normalizeBackendUrl = (rawUrl, proxyType) => {
        if (!rawUrl || proxyType === 'http') return rawUrl;
        try {
          new URL(rawUrl);
          return rawUrl;
        } catch {
          return `${proxyType}://${rawUrl}`;
        }
      };

      const payload = {
        hostname: editForm.hostname,
        backendUrl: normalizeBackendUrl(editForm.backend_url, editForm.proxy_type),
        backendPort: editForm.backend_port || undefined,
        externalPort: editForm.external_port ? parseInt(editForm.external_port, 10) : undefined,
        proxyType: editForm.proxy_type,
        ownerId: parseInt(editForm.user_id, 10),
        teamId: editForm.team_id ? parseInt(editForm.team_id, 10) : null,
        sslEnabled: editForm.proxy_type === 'http' ? editForm.ssl_enabled : false,
        isActive: editForm.is_active,
        description: editForm.description || undefined
      };

      await adminAPI.updateDomain(editingDomain.id, payload);
      await fetchDomains();
      toast({
        title: 'Domain Updated',
        description: `Domain ${editForm.hostname} updated successfully`
      });
      closeEditModal();
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to update domain';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleDomain = async (domain) => {
    try {
      const newStatus = !domain.is_active;
      await adminAPI.updateDomain(domain.id, { isActive: newStatus });
      setDomains(domains.map(d =>
        d.id === domain.id ? { ...d, is_active: newStatus } : d
      ));
      toast({
        title: 'Domain Updated',
        description: `Domain ${domain.hostname} ${newStatus ? 'activated' : 'deactivated'}`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to toggle domain';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleDeleteDomain = async (domain) => {
    const confirmed = window.confirm(`Delete domain "${domain.hostname}"? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await adminAPI.deleteDomain(domain.id);
      setDomains(domains.filter(d => d.id !== domain.id));
      toast({
        title: 'Domain Deleted',
        description: `Domain ${domain.hostname} deleted successfully`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to delete domain';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const getProxyTypeBadgeVariant = (type) => {
    switch (type) {
      case 'http':
      case 'https':
        return 'default';
      case 'tcp':
        return 'success';
      case 'udp':
        return 'warning';
      case 'minecraft':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (domain) => {
    if (!domain.is_active) {
      return <XCircle className="w-4 h-4 text-admin-danger" />;
    }
    if (domain.proxy_type === 'http' && domain.ssl_enabled) {
      return <CheckCircle className="w-4 h-4 text-admin-success" />;
    }
    return <CheckCircle className="w-4 h-4 text-admin-primary" />;
  };

  const filteredDomains = domains
    .filter(d => {
      const matchesSearch = d.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.owner_username?.toLowerCase().includes(searchTerm.toLowerCase());

      if (filterType === 'all') return matchesSearch;
      if (filterType === 'active') return matchesSearch && d.is_active;
      if (filterType === 'inactive') return matchesSearch && !d.is_active;
      if (filterType === 'ssl') return matchesSearch && d.ssl_enabled;

      return matchesSearch && d.proxy_type === filterType;
    });
  const totalPages = Math.max(1, Math.ceil(filteredDomains.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedDomains = filteredDomains.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

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
        <Skeleton className="h-96 bg-admin-border" />
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">Domain Overview</h1>
          <p className="text-admin-text-muted">Monitor all domains across the system</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
          <Input
            type="text"
            placeholder="Search domains..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-admin-bg border-admin-border text-admin-text"
          />
        </div>
        <div className="w-[220px]">
          <Combobox
            value={filterType}
            onValueChange={setFilterType}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'active', label: 'Active Only' },
              { value: 'inactive', label: 'Inactive Only' },
              { value: 'ssl', label: 'SSL Enabled' },
              { value: 'http', label: 'HTTP' },
              { value: 'tcp', label: 'TCP' },
              { value: 'udp', label: 'UDP' },
              { value: 'minecraft', label: 'Minecraft' },
            ]}
            placeholder="All Types"
            searchPlaceholder="Search type..."
            emptyText="No type found."
            triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <AdminStatCard
          title="Total Domains"
          value={domains.length}
          icon={Globe}
        />
        <AdminStatCard
          title="Active"
          value={domains.filter(d => d.is_active).length}
          icon={CheckCircle}
        />
        <AdminStatCard
          title="SSL Enabled"
          value={domains.filter(d => d.ssl_enabled).length}
          icon={Shield}
        />
        <AdminStatCard
          title="Inactive"
          value={domains.filter(d => !d.is_active).length}
          icon={XCircle}
        />
      </div>

      {/* Domains Table */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Domains ({filteredDomains.length})</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">Domain</TableHead>
                  <TableHead className="text-admin-text font-semibold">Owner</TableHead>
                  <TableHead className="text-admin-text font-semibold">Type</TableHead>
                  <TableHead className="text-admin-text font-semibold">Backend</TableHead>
                  <TableHead className="text-admin-text font-semibold">SSL</TableHead>
                  <TableHead className="text-admin-text font-semibold">Status</TableHead>
                  <TableHead className="text-admin-text font-semibold">Created</TableHead>
                  <TableHead className="text-admin-text font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDomains.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-admin-text-muted py-12">
                      No domains found
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedDomains.map((domain) => (
                    <TableRow key={domain.id} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell className="text-admin-text">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(domain)}
                          <span className="font-medium">{domain.hostname}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="text-admin-text">{domain.owner_username}</div>
                          {domain.team_name && (
                            <div className="text-xs text-admin-text-muted flex items-center gap-1 mt-0.5">
                              <Users className="w-3 h-3" />
                              {domain.team_name}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <AdminBadge variant={getProxyTypeBadgeVariant(domain.proxy_type)}>
                          {domain.proxy_type?.toUpperCase() || 'HTTP'}
                        </AdminBadge>
                      </TableCell>
                      <TableCell className="text-admin-text-muted text-sm font-mono max-w-xs truncate">
                        {domain.backend_url || '-'}
                      </TableCell>
                      <TableCell>
                        {domain.proxy_type !== 'http' ? (
                          <AdminBadge variant="secondary">N/A</AdminBadge>
                        ) : domain.ssl_enabled ? (
                          <AdminBadge variant="success" className="flex items-center gap-1 w-fit">
                            <Shield className="w-3 h-3" />
                            Enabled
                          </AdminBadge>
                        ) : (
                          <AdminBadge variant="secondary">Disabled</AdminBadge>
                        )}
                      </TableCell>
                      <TableCell>
                        {domain.is_active ? (
                          <AdminBadge variant="success">Active</AdminBadge>
                        ) : (
                          <AdminBadge variant="danger">Inactive</AdminBadge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-admin-text-muted text-sm">
                          <Clock className="w-3 h-3" />
                          {domain.created_at ? new Date(domain.created_at).toLocaleDateString() : '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(domain)}
                            title="Edit domain"
                          >
                            <Edit className="w-4 h-4" />
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleDomain(domain)}
                            title={domain.is_active ? 'Deactivate domain' : 'Activate domain'}
                            className={domain.is_active ? 'text-admin-warning' : 'text-admin-success'}
                          >
                            <Power className="w-4 h-4" />
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteDomain(domain)}
                            title="Delete domain"
                            className="text-admin-danger hover:text-admin-danger"
                          >
                            <Trash2 className="w-4 h-4" />
                          </AdminButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredDomains.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              label="domains"
            />
        </AdminCardContent>
      </AdminCard>

      {/* Edit Domain Modal */}
      <Dialog open={!!editingDomain} onOpenChange={(open) => !open && closeEditModal()}>
        <DialogContent className="bg-[#111113] border-admin-border max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-admin-text">Edit Domain</DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Domain ID: {editingDomain?.id}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateDomain}>
            <div className="space-y-6 py-4">
              {error && (
                <AdminAlert variant="danger">
                  <AlertCircle className="h-4 w-4" />
                  <AdminAlertDescription>{error}</AdminAlertDescription>
                </AdminAlert>
              )}

              {/* Basic Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-admin-text uppercase tracking-wide">
                    Basic Information
                  </h3>
                </div>
                <Separator className="bg-admin-border" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-admin-text">Hostname *</Label>
                    <Input
                      type="text"
                      value={editForm.hostname}
                      onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })}
                      className="bg-admin-bg border-admin-border text-admin-text"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-admin-text">Proxy Type *</Label>
                    <Combobox
                      value={editForm.proxy_type}
                      onValueChange={(value) => setEditForm({ ...editForm, proxy_type: value })}
                      options={[
                        { value: 'http', label: 'HTTP/HTTPS' },
                        { value: 'tcp', label: 'TCP' },
                        { value: 'udp', label: 'UDP' },
                        { value: 'minecraft', label: 'Minecraft' },
                      ]}
                      placeholder="Select proxy type"
                      searchPlaceholder="Search proxy type..."
                      emptyText="No proxy type found."
                      triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-admin-text">Description</Label>
                  <Textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    rows={2}
                    placeholder="Optional description"
                  />
                </div>
              </div>

              {/* Ownership */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-admin-text uppercase tracking-wide">
                  Ownership
                </h3>
                <Separator className="bg-admin-border" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-admin-text">Owner (User) *</Label>
                    <Combobox
                      value={editForm.user_id.toString()}
                      onValueChange={(value) => setEditForm({ ...editForm, user_id: value })}
                      options={users.map((user) => ({
                        value: user.id.toString(),
                        label: `${user.username}${user.display_name ? ` (${user.display_name})` : ''}`,
                      }))}
                      placeholder="Select user..."
                      searchPlaceholder="Search user..."
                      emptyText="No user found."
                      triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-admin-text">Team (Optional)</Label>
                    <Combobox
                      value={editForm.team_id.toString()}
                      onValueChange={(value) => setEditForm({ ...editForm, team_id: value })}
                      options={[
                        { value: '', label: 'No team (personal domain)' },
                        ...teams.map((team) => ({ value: team.id.toString(), label: team.name })),
                      ]}
                      placeholder="No team (personal domain)"
                      searchPlaceholder="Search team..."
                      emptyText="No team found."
                      triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                    />
                  </div>
                </div>
              </div>

              {/* Backend Configuration */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-admin-text uppercase tracking-wide">
                  Backend Configuration
                </h3>
                <Separator className="bg-admin-border" />

                <div className="space-y-2">
                  <Label className="text-admin-text">
                    Backend URL {editForm.proxy_type === 'http' && '*'}
                  </Label>
                  <Input
                    type="text"
                    value={editForm.backend_url}
                    onChange={(e) => setEditForm({ ...editForm, backend_url: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder={editForm.proxy_type === 'http' ? 'http://localhost:8080' : '192.168.1.100'}
                    required={editForm.proxy_type === 'http'}
                  />
                  <p className="text-xs text-admin-text-muted">
                    {editForm.proxy_type === 'http'
                      ? 'Full URL including protocol (http:// or https://)'
                      : 'IP address or hostname (no protocol)'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-admin-text">
                      Backend Port {editForm.proxy_type !== 'http' && '*'}
                    </Label>
                    <Input
                      type="number"
                      value={editForm.backend_port}
                      onChange={(e) => setEditForm({ ...editForm, backend_port: e.target.value })}
                      className="bg-admin-bg border-admin-border text-admin-text"
                      placeholder="8080"
                      min="1"
                      max="65535"
                      required={editForm.proxy_type !== 'http'}
                    />
                  </div>

                  {(editForm.proxy_type === 'tcp' || editForm.proxy_type === 'udp') && (
                    <div className="space-y-2">
                      <Label className="text-admin-text">External Port *</Label>
                      <Input
                        type="number"
                        value={editForm.external_port}
                        onChange={(e) => setEditForm({ ...editForm, external_port: e.target.value })}
                        className="bg-admin-bg border-admin-border text-admin-text"
                        placeholder="25565"
                        min="1"
                        max="65535"
                        required
                      />
                      <p className="text-xs text-admin-text-muted">
                        Port exposed to the internet
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* SSL Settings */}
              {editForm.proxy_type === 'http' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-admin-text uppercase tracking-wide">
                    SSL Configuration
                  </h3>
                  <Separator className="bg-admin-border" />

                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="ssl_enabled"
                        checked={editForm.ssl_enabled}
                        onCheckedChange={(checked) => setEditForm({ ...editForm, ssl_enabled: checked })}
                        className="mt-1 border-admin-border data-[state=checked]:bg-admin-primary data-[state=checked]:border-admin-primary"
                      />
                      <div className="flex-1">
                        <Label htmlFor="ssl_enabled" className="text-admin-text font-medium cursor-pointer">
                          Enable SSL/TLS
                        </Label>
                        <p className="text-xs text-admin-text-muted">
                          Automatically obtain Let's Encrypt certificate
                        </p>
                      </div>
                    </div>

                    {editForm.ssl_enabled && (
                      <div className="flex items-start gap-3 ml-7">
                        <Checkbox
                          id="ssl_force_redirect"
                          checked={editForm.ssl_force_redirect}
                          onCheckedChange={(checked) => setEditForm({ ...editForm, ssl_force_redirect: checked })}
                          className="mt-1 border-admin-border data-[state=checked]:bg-admin-primary data-[state=checked]:border-admin-primary"
                        />
                        <div className="flex-1">
                          <Label htmlFor="ssl_force_redirect" className="text-admin-text font-medium cursor-pointer">
                            Force HTTPS Redirect
                          </Label>
                          <p className="text-xs text-admin-text-muted">
                            Redirect all HTTP traffic to HTTPS
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-admin-text uppercase tracking-wide">
                  Status
                </h3>
                <Separator className="bg-admin-border" />

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="is_active"
                    checked={editForm.is_active}
                    onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: checked })}
                    className="mt-1 border-admin-border data-[state=checked]:bg-admin-primary data-[state=checked]:border-admin-primary"
                  />
                  <div className="flex-1">
                    <Label htmlFor="is_active" className="text-admin-text font-medium cursor-pointer">
                      Domain is active
                    </Label>
                    <p className="text-xs text-admin-text-muted">
                      Inactive domains will not accept traffic
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={closeEditModal}
                disabled={submitting}
              >
                Cancel
              </AdminButton>
              <AdminButton type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Changes'}
              </AdminButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

