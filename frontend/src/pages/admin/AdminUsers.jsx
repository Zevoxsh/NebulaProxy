import { useState, useEffect } from 'react';
import { Users, Edit, Trash2, Power, AlertCircle, UserCheck, Search, UserPlus, Shield } from 'lucide-react';
import { adminAPI, authAPI } from '../../api/client';
import { getAvatarUrl } from '../../utils/gravatar';
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
import { Switch } from '@/components/ui/switch';
import { Combobox } from '@/components/ui/combobox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [quotaForm, setQuotaForm] = useState({ maxDomains: 0, maxRedirections: 10 });
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [authMode, setAuthMode] = useState('ldap');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    displayName: '',
    email: '',
    role: 'user',
    maxDomains: 0,
    maxRedirections: 10
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
    fetchAuthMode();
    fetchRegistrationConfig();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.listUsers();
      setUsers(response.data.users);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuthMode = async () => {
    try {
      const response = await authAPI.getMode();
      setAuthMode(response.data.authType || 'enterprise');
    } catch (err) {
      console.error('Failed to fetch auth mode:', err);
    }
  };

  const fetchRegistrationConfig = async () => {
    try {
      const response = await adminAPI.getRegistrationConfig();
      setRegistrationEnabled(response.data.config.enabled);
    } catch (err) {
      console.error('Failed to fetch registration config:', err);
    }
  };

  const openEditQuotas = (user) => {
    setEditingUser(user);
    setQuotaForm({
      maxDomains: user.max_domains,
      maxRedirections: user.max_redirections || 10
    });
  };

  const closeEditQuotas = () => {
    setEditingUser(null);
    setError('');
  };

  const handleUpdateQuotas = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      await adminAPI.updateQuotas(editingUser.id, quotaForm);
      await fetchUsers();
      closeEditQuotas();
      toast({
        title: 'Success',
        description: `Quotas updated for ${editingUser.username}`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to update quotas';
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

  const handleToggleUser = async (user) => {
    try {
      await adminAPI.toggleUser(user.id);
      setUsers(users.map(u =>
        u.id === user.id ? { ...u, is_active: !u.is_active } : u
      ));
      toast({
        title: 'Success',
        description: `User ${user.is_active ? 'disabled' : 'enabled'} successfully`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to toggle user';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleDeleteUser = async (user) => {
    const confirmed = window.confirm(`Delete user "${user.username}"? This will remove all domains.`);
    if (!confirmed) {
      return;
    }

    try {
      await adminAPI.deleteUser(user.id);
      setUsers(prev => prev.filter(u => u.id !== user.id));
      toast({
        title: 'User Deleted',
        description: `User "${user.username}" has been deleted`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to delete user';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      await adminAPI.createUser(createForm);
      await fetchUsers();
      setShowCreateModal(false);
      toast({
        title: 'User Created',
        description: `User "${createForm.username}" created successfully`
      });
      setCreateForm({
        username: '',
        password: '',
        displayName: '',
        email: '',
        role: 'user',
        maxDomains: 0,
        maxRedirections: 10
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to create user';
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

  const handleToggleRegistration = async () => {
    try {
      const newValue = !registrationEnabled;
      await adminAPI.updateRegistrationConfig({ enabled: newValue });
      setRegistrationEnabled(newValue);
      toast({
        title: 'Registration Updated',
        description: `Public registration ${newValue ? 'enabled' : 'disabled'}`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to update registration config';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const filteredUsers = users.filter(user =>
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + itemsPerPage);

  const activeUsers = users.filter(u => u.is_active).length;
  const adminUsers = users.filter(u => u.role === 'admin').length;
  const totalDomains = users.reduce((sum, u) => sum + (u.domain_count || 0), 0);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

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
          <h1 className="text-3xl font-semibold text-admin-text mb-2">User Management</h1>
          <p className="text-admin-text-muted">Manage user accounts, quotas, and permissions</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
            <Input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-[300px] bg-admin-bg border-admin-border text-admin-text"
            />
          </div>
          {authMode === 'local' && (
            <AdminButton onClick={() => setShowCreateModal(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Add User
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

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <AdminStatCard
          title="Total Users"
          value={users.length}
          icon={Users}
        />
        <AdminStatCard
          title="Active Users"
          value={activeUsers}
          icon={UserCheck}
        />
        <AdminStatCard
          title="Administrators"
          value={adminUsers}
          icon={Shield}
        />
        <AdminStatCard
          title="Total Domains"
          value={totalDomains}
          icon={Users}
        />
      </div>

      {/* Registration Toggle (Local Mode Only) */}
      {authMode === 'local' && (
        <AdminCard>
          <AdminCardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-admin-text mb-1">Public Registration</h3>
                <p className="text-sm text-admin-text-muted">
                  Allow users to create accounts via the registration page
                </p>
              </div>
              <Switch
                checked={registrationEnabled}
                onCheckedChange={handleToggleRegistration}
                className="data-[state=checked]:bg-admin-primary"
              />
            </div>
          </AdminCardContent>
        </AdminCard>
      )}

      {/* Users Table */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>User Accounts</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">User</TableHead>
                  <TableHead className="text-admin-text font-semibold">Role</TableHead>
                  <TableHead className="text-admin-text font-semibold">Domains</TableHead>
                  <TableHead className="text-admin-text font-semibold">Quota</TableHead>
                  <TableHead className="text-admin-text font-semibold">Redirections</TableHead>
                  <TableHead className="text-admin-text font-semibold">Status</TableHead>
                  <TableHead className="text-admin-text font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-admin-text-muted py-12">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedUsers.map((user) => (
                    <TableRow key={user.id} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell className="text-admin-text">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage
                              src={getAvatarUrl(user.avatar_url, user.email, 80, user.avatar_updated_at)}
                              alt={user.username}
                            />
                            <AvatarFallback className="bg-admin-primary text-white">
                              {user.display_name?.charAt(0) || user.username?.charAt(0) || 'U'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-admin-text">{user.username}</div>
                            {user.email && (
                              <div className="text-xs text-admin-text-muted">{user.email}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {user.role === 'admin' ? (
                          <AdminBadge variant="default" className="flex items-center gap-1 w-fit">
                            <Shield className="w-3 h-3" />
                            Admin
                          </AdminBadge>
                        ) : (
                          <AdminBadge variant="secondary">User</AdminBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-admin-text font-medium">
                        {user.domain_count || 0}
                      </TableCell>
                      <TableCell className="text-admin-text-muted">
                        {user.max_domains === -1 ? 'Unlimited' : user.max_domains}
                      </TableCell>
                      <TableCell className="text-admin-text">
                        {user.redirection_count || 0} / {user.max_redirections || 10}
                      </TableCell>
                      <TableCell>
                        {user.is_active ? (
                          <AdminBadge variant="success">Active</AdminBadge>
                        ) : (
                          <AdminBadge variant="danger">Disabled</AdminBadge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditQuotas(user)}
                            title="Edit Quotas"
                          >
                            <Edit className="w-4 h-4" />
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleUser(user)}
                            title={user.is_active ? 'Disable User' : 'Enable User'}
                            className={user.is_active ? 'text-admin-success' : 'text-admin-text-muted'}
                          >
                            <Power className="w-4 h-4" />
                          </AdminButton>
                          {user.role !== 'admin' && (
                            <AdminButton
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteUser(user)}
                              title="Delete User"
                              className="text-admin-danger hover:text-admin-danger"
                            >
                              <Trash2 className="w-4 h-4" />
                            </AdminButton>
                          )}
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
              totalItems={filteredUsers.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              label="users"
            />
        </AdminCardContent>
      </AdminCard>

      {/* Edit Quotas Modal */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && closeEditQuotas()}>
        <DialogContent className="bg-[#111113] border-admin-border">
          <DialogHeader>
            <DialogTitle className="text-admin-text">Edit User Quotas</DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Update quota limits for {editingUser?.username}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateQuotas}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-admin-text">Max Domains (-1 for unlimited)</Label>
                <Input
                  type="number"
                  value={quotaForm.maxDomains}
                  onChange={(e) => setQuotaForm({ ...quotaForm, maxDomains: parseInt(e.target.value) })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Max Redirections</Label>
                <Input
                  type="number"
                  value={quotaForm.maxRedirections}
                  onChange={(e) => setQuotaForm({ ...quotaForm, maxRedirections: parseInt(e.target.value) })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={closeEditQuotas}
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

      {/* Create User Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="bg-[#111113] border-admin-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-admin-text">Create New User</DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Add a new user account with custom quotas
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser}>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Username *</Label>
                  <Input
                    type="text"
                    value={createForm.username}
                    onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    pattern="[a-zA-Z0-9._@-]+"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Display Name</Label>
                  <Input
                    type="text"
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Email</Label>
                  <Input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Password *</Label>
                  <Input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    minLength={6}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Role</Label>
                  <Combobox
                    value={createForm.role}
                    onValueChange={(value) => setCreateForm({ ...createForm, role: value })}
                    options={[
                      { value: 'user', label: 'User' },
                      { value: 'admin', label: 'Admin' },
                    ]}
                    placeholder="Select role"
                    searchPlaceholder="Search role..."
                    emptyText="No role found."
                    triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Max Domains</Label>
                  <Input
                    type="number"
                    value={createForm.maxDomains}
                    onChange={(e) => setCreateForm({ ...createForm, maxDomains: parseInt(e.target.value) })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Max Redirections</Label>
                  <Input
                    type="number"
                    value={createForm.maxRedirections}
                    onChange={(e) => setCreateForm({ ...createForm, maxRedirections: parseInt(e.target.value) })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    required
                  />
                </div>
              </div>

              {error && (
                <AdminAlert variant="danger">
                  <AlertCircle className="h-4 w-4" />
                  <AdminAlertDescription>{error}</AdminAlertDescription>
                </AdminAlert>
              )}
            </div>
            <DialogFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </AdminButton>
              <AdminButton type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create User'}
              </AdminButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

