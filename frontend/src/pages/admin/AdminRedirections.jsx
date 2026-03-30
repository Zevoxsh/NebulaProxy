import { useState, useEffect } from 'react';
import { Link2, Edit, Trash2, Power, AlertCircle, Search, TrendingUp, ExternalLink } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function AdminRedirections() {
  const [redirections, setRedirections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingRedirection, setEditingRedirection] = useState(null);
  const [redirectionForm, setRedirectionForm] = useState({
    shortCode: '',
    targetUrl: '',
    description: '',
    isActive: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { toast } = useToast();

  useEffect(() => {
    fetchRedirections();
  }, []);

  const fetchRedirections = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getAllRedirections();
      setRedirections(response.data.redirections);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load redirections');
    } finally {
      setLoading(false);
    }
  };

  const openEditRedirection = (redirection) => {
    setEditingRedirection(redirection);
    setRedirectionForm({
      shortCode: redirection.short_code,
      targetUrl: redirection.target_url,
      description: redirection.description || '',
      isActive: redirection.is_active
    });
  };

  const closeEditRedirection = () => {
    setEditingRedirection(null);
    setError('');
  };

  const handleToggleRedirection = async (redirection) => {
    try {
      await adminAPI.toggleRedirection(redirection.id);
      setRedirections(redirections.map(r =>
        r.id === redirection.id ? { ...r, is_active: !r.is_active } : r
      ));
      toast({
        title: 'Redirection Updated',
        description: `Redirection ${redirection.is_active ? 'disabled' : 'enabled'} successfully`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to toggle redirection';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleDeleteRedirection = async (redirection) => {
    const confirmed = window.confirm(`Delete redirection "${redirection.short_code}"?`);
    if (!confirmed) return;

    try {
      await adminAPI.deleteRedirection(redirection.id);
      setRedirections(prev => prev.filter(r => r.id !== redirection.id));
      toast({
        title: 'Redirection Deleted',
        description: `Redirection ${redirection.short_code} deleted successfully`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to delete redirection';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleUpdateRedirection = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await adminAPI.updateRedirection(editingRedirection.id, redirectionForm);
      await fetchRedirections();
      closeEditRedirection();
      toast({
        title: 'Redirection Updated',
        description: `Redirection updated successfully`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to update redirection';
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

  const filteredRedirections = redirections.filter(r =>
    r.short_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.target_url?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.owner_username?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filteredRedirections.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedRedirections = filteredRedirections.slice(startIndex, startIndex + itemsPerPage);

  const totalClicks = redirections.reduce((sum, r) => sum + (r.click_count || 0), 0);
  const activeRedirections = redirections.filter(r => r.is_active).length;

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
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
          <h1 className="text-3xl font-semibold text-admin-text mb-2">Redirection Management</h1>
          <p className="text-admin-text-muted">Manage short URLs and redirections</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
          <Input
            type="text"
            placeholder="Search redirections..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 w-[300px] bg-admin-bg border-admin-border text-admin-text"
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AdminStatCard
          title="Total Redirections"
          value={redirections.length}
          icon={Link2}
        />
        <AdminStatCard
          title="Active"
          value={activeRedirections}
          icon={Power}
        />
        <AdminStatCard
          title="Total Clicks"
          value={totalClicks.toLocaleString()}
          icon={TrendingUp}
        />
      </div>

      {/* Redirections Table */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Redirections ({filteredRedirections.length})</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">Short Code</TableHead>
                  <TableHead className="text-admin-text font-semibold">Target URL</TableHead>
                  <TableHead className="text-admin-text font-semibold">Owner</TableHead>
                  <TableHead className="text-admin-text font-semibold">Clicks</TableHead>
                  <TableHead className="text-admin-text font-semibold">Status</TableHead>
                  <TableHead className="text-admin-text font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRedirections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-admin-text-muted py-12">
                      No redirections found
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRedirections.map((redirection) => (
                    <TableRow key={redirection.id} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                      <TableCell className="text-admin-text">
                        <div className="flex items-center gap-2">
                          <Link2 className="w-4 h-4 text-admin-primary" />
                          <span className="font-mono">/r/{redirection.short_code}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <a
                          href={redirection.target_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-admin-primary hover:text-admin-primary-strong text-sm flex items-center gap-1 max-w-md truncate"
                        >
                          <span className="truncate">{redirection.target_url}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell className="text-admin-text">
                        {redirection.owner_username}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-3 h-3 text-admin-success" />
                          <span className="text-admin-text font-medium">
                            {redirection.click_count?.toLocaleString() || 0}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {redirection.is_active ? (
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
                            onClick={() => openEditRedirection(redirection)}
                            title="Edit Redirection"
                          >
                            <Edit className="w-4 h-4" />
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleRedirection(redirection)}
                            title={redirection.is_active ? 'Disable' : 'Enable'}
                            className={redirection.is_active ? 'text-admin-success' : 'text-admin-text-muted'}
                          >
                            <Power className="w-4 h-4" />
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRedirection(redirection)}
                            title="Delete Redirection"
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
              totalItems={filteredRedirections.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              label="redirections"
            />
        </AdminCardContent>
      </AdminCard>

      {/* Edit Redirection Modal */}
      <Dialog open={!!editingRedirection} onOpenChange={(open) => !open && closeEditRedirection()}>
        <DialogContent className="bg-[#111113] border-admin-border">
          <DialogHeader>
            <DialogTitle className="text-admin-text">Edit Redirection</DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Update redirection details
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateRedirection}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-admin-text">Short Code</Label>
                <Input
                  type="text"
                  value={redirectionForm.shortCode}
                  onChange={(e) => setRedirectionForm({ ...redirectionForm, shortCode: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Target URL</Label>
                <Input
                  type="url"
                  value={redirectionForm.targetUrl}
                  onChange={(e) => setRedirectionForm({ ...redirectionForm, targetUrl: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Description</Label>
                <Input
                  type="text"
                  value={redirectionForm.description}
                  onChange={(e) => setRedirectionForm({ ...redirectionForm, description: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  placeholder="Optional description"
                />
              </div>
              <div className="flex items-center justify-between p-4 bg-admin-bg rounded-lg border border-admin-border">
                <div>
                  <div className="text-sm font-medium text-admin-text">Active</div>
                  <div className="text-xs text-admin-text-muted">Enable or disable this redirection</div>
                </div>
                <Switch
                  checked={redirectionForm.isActive}
                  onCheckedChange={(checked) => setRedirectionForm({ ...redirectionForm, isActive: checked })}
                  className="data-[state=checked]:bg-admin-primary"
                />
              </div>
            </div>
            <DialogFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={closeEditRedirection}
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

