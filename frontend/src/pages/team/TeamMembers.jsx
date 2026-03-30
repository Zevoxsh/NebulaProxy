import { useState, useEffect } from 'react';
import { UserPlus, Crown, Lock, Trash2, X } from 'lucide-react';
import { teamAPI } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { getAvatarUrl } from '../../utils/gravatar';

export default function TeamMembers({ team, refreshTeam, setError, setSuccess }) {
  const { user } = useAuthStore();
  const [showAddMember, setShowAddMember] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [invitations, setInvitations] = useState([]);

  const [memberForm, setMemberForm] = useState({
    username: '',
    permissions: {
      canManageDomains: false,
      canManageMembers: false,
      canManageSettings: false
    }
  });

  const [permissionsForm, setPermissionsForm] = useState({
    canManageDomains: false,
    canManageMembers: false,
    canManageSettings: false
  });

  const canManageMembers = team.user_permissions?.can_manage_members
    ?? (team.user_role === 'owner' || Boolean(team.members?.find(m => String(m.user_id) === String(user?.id))?.can_manage_members));

  useEffect(() => {
    fetchInvitations();
  }, [team.id]);

  const fetchInvitations = async () => {
    try {
      const response = await teamAPI.getInvitations(team.id);
      setInvitations(response.data.invitations || []);
    } catch (err) {
      console.error('Failed to fetch invitations:', err);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      const isAlreadyMember = team.members?.some(
        member => member.username.toLowerCase() === memberForm.username.toLowerCase()
      );

      if (isAlreadyMember) {
        setError(`User ${memberForm.username} is already a member of this team`);
        setSubmitting(false);
        return;
      }

      const hasPendingInvitation = invitations?.some(
        inv => inv.invited_username?.toLowerCase() === memberForm.username.toLowerCase() && inv.status === 'pending'
      );

      if (hasPendingInvitation) {
        setError(`An invitation has already been sent to ${memberForm.username}`);
        setSubmitting(false);
        return;
      }

      await teamAPI.sendInvitation(team.id, memberForm.username, memberForm.permissions);
      setSuccess(`Invitation sent to ${memberForm.username}`);
      setShowAddMember(false);
      setMemberForm({
        username: '',
        permissions: { canManageDomains: false, canManageMembers: false, canManageSettings: false }
      });

      await refreshTeam();
      await fetchInvitations();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!confirm('Remove this member from the team?')) return;

    try {
      await teamAPI.removeMember(team.id, memberId);
      setSuccess('Member removed successfully');
      await refreshTeam();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove member');
    }
  };

  const handleShowPermissions = (member) => {
    setSelectedMember(member);
    setPermissionsForm({
      canManageDomains: Boolean(member.can_manage_domains),
      canManageMembers: Boolean(member.can_manage_members),
      canManageSettings: Boolean(member.can_manage_settings)
    });
    setShowPermissions(true);
  };

  const handleUpdatePermissions = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await teamAPI.updateMemberPermissions(team.id, selectedMember.user_id, permissionsForm);
      setSuccess('Permissions updated successfully');
      setShowPermissions(false);
      setSelectedMember(null);
      await refreshTeam();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update permissions');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInvitation = async (invitationId) => {
    if (!confirm('Cancel this invitation?')) return;

    try {
      await teamAPI.cancelInvitation(team.id, invitationId);
      setSuccess('Invitation cancelled');
      await fetchInvitations();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel invitation');
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-normal text-white">Members ({team.member_count})</h3>
          {canManageMembers && (
            <button
              onClick={() => { setShowAddMember(true); setError(''); }}
              className="btn-primary flex items-center gap-2 text-xs px-3 py-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
              Add Member
            </button>
          )}
        </div>

        <div className="space-y-2">
          {team.members?.map(member => (
            <div key={member.id} className="p-3 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors duration-300">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {getAvatarUrl(member.avatar_url, member.email, 64, member.avatar_updated_at) ? (
                      <img src={getAvatarUrl(member.avatar_url, member.email, 64, member.avatar_updated_at)} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-medium text-white">
                        {member.display_name?.charAt(0) || member.username?.charAt(0) || 'U'}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-normal text-white truncate">{member.display_name || member.username}</p>
                    <p className="text-xs text-white/40 truncate">{member.username}</p>
                  </div>
                </div>

                {member.role === 'owner' ? (
                  <Crown className="w-5 h-5 text-[#F59E0B] flex-shrink-0" strokeWidth={1.5} />
                ) : canManageMembers ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {team.user_role === 'owner' && (
                      <button
                        onClick={() => handleShowPermissions(member)}
                        className="p-1.5 text-white/60 hover:text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded transition-all duration-300"
                        title="Permissions"
                      >
                        <Lock className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="p-1.5 text-white/60 hover:text-[#F87171] hover:bg-[#EF4444]/10 rounded transition-all duration-300"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                ) : null}
              </div>

              {member.role !== 'owner' && (
                <div className="flex flex-wrap gap-1.5">
                  {member.can_manage_domains && (
                    <span className="text-[9px] px-2 py-0.5 bg-[#10B981]/10 text-[#34D399] border border-[#10B981]/20 rounded-full">Domains</span>
                  )}
                  {member.can_manage_members && (
                    <span className="text-[9px] px-2 py-0.5 bg-[#9D4EDD]/10 text-[#C77DFF] border border-[#9D4EDD]/20 rounded-full">Members</span>
                  )}
                  {member.can_manage_settings && (
                    <span className="text-[9px] px-2 py-0.5 bg-[#06B6D4]/10 text-[#22D3EE] border border-[#06B6D4]/20 rounded-full">Settings</span>
                  )}
                  {!member.can_manage_domains && !member.can_manage_members && !member.can_manage_settings && (
                    <span className="text-[9px] px-2 py-0.5 bg-white/[0.05] text-white/40 rounded-full">View Only</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pending Invitations */}
        {invitations.filter(inv => inv.status === 'pending').length > 0 && (
          <div className="mt-6 pt-6 border-t border-white/[0.05]">
            <h4 className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-3">Pending Invitations</h4>
            <div className="space-y-2">
              {invitations.filter(inv => inv.status === 'pending').map(invitation => (
                <div key={invitation.id} className="p-3 bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-normal text-white/90 truncate">{invitation.invited_display_name || invitation.invited_username}</p>
                      <p className="text-xs text-white/40 truncate">{invitation.invited_username}</p>
                    </div>
                    {canManageMembers && (
                      <button
                        onClick={() => handleCancelInvitation(invitation.id)}
                        className="p-1 text-white/60 hover:text-[#F87171] hover:bg-[#EF4444]/10 rounded transition-all duration-300 flex-shrink-0"
                        title="Cancel invitation"
                      >
                        <X className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-md w-full p-5 shadow-lg animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-light text-white">Add Member</h2>
              <button onClick={() => { setShowAddMember(false); setError(''); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="text-[10px] font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">Username</label>
                <input
                  type="text"
                  value={memberForm.username}
                  onChange={(e) => setMemberForm({ ...memberForm, username: e.target.value })}
                  placeholder="Enter username"
                  required
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-white/50 uppercase tracking-[0.15em] mb-3 block">Permissions</label>
                <div className="space-y-2">
                  {[
                    { key: 'canManageDomains', label: 'Manage Domains', desc: 'Add, edit, remove domains' },
                    { key: 'canManageMembers', label: 'Manage Members', desc: 'Add, remove members' },
                    { key: 'canManageSettings', label: 'Manage Settings', desc: 'Edit team settings' }
                  ].map(perm => (
                    <label key={perm.key} className="flex items-start gap-3 p-2.5 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors duration-300">
                      <input
                        type="checkbox"
                        checked={memberForm.permissions[perm.key]}
                        onChange={(e) => setMemberForm({
                          ...memberForm,
                          permissions: { ...memberForm.permissions, [perm.key]: e.target.checked }
                        })}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <p className="text-xs text-white font-normal">{perm.label}</p>
                        <p className="text-[10px] text-white/40 mt-0.5">{perm.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => { setShowAddMember(false); setError(''); }} disabled={submitting} className="btn-secondary flex-1 text-xs px-4 py-2.5">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 text-xs px-4 py-2.5">{submitting ? 'Adding...' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {showPermissions && selectedMember && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-md w-full p-5 shadow-lg animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-light text-white">Permissions</h2>
                <p className="text-[10px] text-white/50 mt-1">{selectedMember.display_name || selectedMember.username}</p>
              </div>
              <button onClick={() => { setShowPermissions(false); setSelectedMember(null); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleUpdatePermissions} className="space-y-2">
              {[
                { key: 'canManageDomains', label: 'Manage Domains', desc: 'Add, edit, remove domains' },
                { key: 'canManageMembers', label: 'Manage Members', desc: 'Add, remove members' },
                { key: 'canManageSettings', label: 'Manage Settings', desc: 'Edit team settings' }
              ].map(perm => (
                <label key={perm.key} className="flex items-start gap-3 p-2.5 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors duration-300">
                  <input
                    type="checkbox"
                    checked={permissionsForm[perm.key]}
                    onChange={(e) => setPermissionsForm({ ...permissionsForm, [perm.key]: e.target.checked })}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-xs text-white font-normal">{perm.label}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">{perm.desc}</p>
                  </div>
                </label>
              ))}

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => { setShowPermissions(false); setSelectedMember(null); }} disabled={submitting} className="btn-secondary flex-1 text-xs px-4 py-2.5">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 text-xs px-4 py-2.5">{submitting ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
