import { useState, useEffect } from 'react';
import { Shield, Edit, AlertCircle, Users, Globe, Search } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardContent,
  AdminCardFooter,
  AdminButton,
  AdminAlert,
  AdminAlertDescription,
  AdminModal,
  AdminModalContent,
  AdminModalHeader,
  AdminModalTitle,
  AdminModalFooter
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function AdminTeams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTeam, setEditingTeam] = useState(null);
  const [teamQuotaForm, setTeamQuotaForm] = useState({ maxDomains: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;
  const { toast } = useToast();

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getAllTeams();
      setTeams(response.data.teams);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const openEditTeamQuota = (team) => {
    setEditingTeam(team);
    setTeamQuotaForm({
      maxDomains: team.domain_quota ?? team.max_domains ?? 0
    });
  };

  const closeEditTeamQuota = () => {
    setEditingTeam(null);
    setError('');
  };

  const handleUpdateTeamQuota = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await adminAPI.updateTeamQuota(editingTeam.id, {
        maxDomains: teamQuotaForm.maxDomains
      });
      await fetchTeams();
      toast({
        title: 'Success',
        description: 'Team quota updated successfully'
      });
      closeEditTeamQuota();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update team quota');
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update team quota'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredTeams = teams.filter(team =>
    team.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    team.owner_username?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filteredTeams.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTeams = filteredTeams.slice(startIndex, startIndex + itemsPerPage);

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40 bg-admin-border" />
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
          <h1 className="text-3xl font-semibold text-admin-text mb-2">Team Management</h1>
          <p className="text-admin-text-muted">Manage teams, quotas, and members</p>
        </div>
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-text-subtle" />
          <Input
            type="text"
            placeholder="Search teams..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-admin-bg border-admin-border text-admin-text"
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

      {/* Teams Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTeams.length === 0 ? (
          <div className="col-span-full text-center text-admin-text-muted py-12">
            No teams found
          </div>
        ) : (
          paginatedTeams.map((team) => (
            <AdminCard key={team.id}>
              <AdminCardHeader>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden ${team.logo_url ? 'bg-admin-surface2' : 'bg-gradient-to-br from-admin-primary to-admin-success'}`}>
                      {team.logo_url ? (
                        <img
                          src={`${team.logo_url}${team.logo_updated_at ? `?t=${new Date(team.logo_updated_at).getTime()}` : ''}`}
                          alt={`${team.name} logo`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Shield className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-admin-text">{team.name}</h3>
                      <p className="text-xs text-admin-text-muted">
                        Owner: {team.owner_username}
                      </p>
                    </div>
                  </div>
                  <AdminButton
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditTeamQuota(team)}
                    title="Edit Quota"
                  >
                    <Edit className="w-4 h-4" />
                  </AdminButton>
                </div>
              </AdminCardHeader>
              <AdminCardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-admin-text-muted text-xs mb-1">
                      <Users className="w-3 h-3" />
                      <span>Members</span>
                    </div>
                    <div className="text-2xl font-bold text-admin-text">
                      {team.member_count || 0}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-admin-text-muted text-xs mb-1">
                      <Globe className="w-3 h-3" />
                      <span>Domains</span>
                    </div>
                    <div className="text-2xl font-bold text-admin-text">
                      {team.domain_count || 0}
                      <span className="text-sm text-admin-text-muted ml-1">
                        / {team.domain_quota === -1 ? '∞' : team.domain_quota || team.max_domains || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </AdminCardContent>
            </AdminCard>
          ))
        )}
      </div>
      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={filteredTeams.length}
        pageSize={itemsPerPage}
        onPageChange={setCurrentPage}
        label="teams"
      />

      {/* Edit Team Quota Modal */}
      <AdminModal open={editingTeam !== null} onOpenChange={(open) => !open && closeEditTeamQuota()}>
        <AdminModalContent>
          <AdminModalHeader>
            <AdminModalTitle>Edit Team Quota</AdminModalTitle>
          </AdminModalHeader>
          <form onSubmit={handleUpdateTeamQuota}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-admin-text">Team Name</Label>
                <Input
                  type="text"
                  value={editingTeam?.name || ''}
                  disabled
                  className="bg-admin-bg border-admin-border text-admin-text opacity-50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">
                  Max Domains (-1 for unlimited)
                </Label>
                <Input
                  type="number"
                  value={teamQuotaForm.maxDomains}
                  onChange={(e) => setTeamQuotaForm({ maxDomains: parseInt(e.target.value) })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  required
                />
              </div>
            </div>
            <AdminModalFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={closeEditTeamQuota}
              >
                Cancel
              </AdminButton>
              <AdminButton
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Saving...' : 'Save Changes'}
              </AdminButton>
            </AdminModalFooter>
          </form>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
