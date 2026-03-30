import { useState, useEffect } from 'react';
import { Folder, Plus, ArrowLeft, Trash2, Users, Globe, X, UserPlus, Settings } from 'lucide-react';
import { domainGroupAPI, domainAPI, teamAPI } from '../api/client';
import GroupBadge from '../components/ui/GroupBadge';
import ColorPicker from '../components/ui/ColorPicker';
import { Combobox } from '../components/ui/combobox';

export default function DomainGroups() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupDomains, setGroupDomains] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [availableDomains, setAvailableDomains] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddDomainsModal, setShowAddDomainsModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Form states
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    color: '#9D4EDD',
    icon: '📁',
    type: 'personal',
    teamId: null
  });

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    color: '#9D4EDD',
    icon: '📁'
  });

  const [selectedDomains, setSelectedDomains] = useState([]);
  const [selectedTeamMembers, setSelectedTeamMembers] = useState([]);
  const [memberPermissions, setMemberPermissions] = useState({
    canManageGroup: false,
    canAssignDomains: false,
    canViewDomains: true
  });

  const [filterOwnership, setFilterOwnership] = useState('all');

  // Fetch groups
  const fetchGroups = async () => {
    try {
      setLoading(true);
      const [groupsRes, teamsRes] = await Promise.all([
        domainGroupAPI.list(),
        teamAPI.list()
      ]);
      setGroups(groupsRes.data.groups || []);
      setTeams(teamsRes.data.teams || []);
    } catch (error) {
      console.error('Error fetching groups:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch group details
  const fetchGroupDetails = async (groupId) => {
    try {
      const response = await domainGroupAPI.get(groupId);
      setGroupDomains(response.data.group.domains || []);
      setGroupMembers(response.data.group.members || []);
    } catch (error) {
      console.error('Error fetching group details:', error);
    }
  };

  const refreshSelectedGroup = async (groupId) => {
    if (!groupId) return;
    try {
      const response = await domainGroupAPI.get(groupId);
      const groupData = response.data.group || {};
      setGroupDomains(groupData.domains || []);
      setGroupMembers(groupData.members || []);
      setSelectedGroup((prev) => (prev && prev.id === groupId ? { ...prev, ...groupData } : prev));
    } catch (error) {
      console.error('Error refreshing group details:', error);
    }
  };

  useEffect(() => {
    fetchGroups();
    // Auto-refresh disabled - was interrupting user actions
    // const interval = setInterval(fetchGroups, 10000);
    // return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedGroup) {
      refreshSelectedGroup(selectedGroup.id);
      // Auto-refresh disabled - was annoying when editing forms
      // const interval = setInterval(() => fetchGroupDetails(selectedGroup.id), 5000);
      // return () => clearInterval(interval);
    }
  }, [selectedGroup]);

  // Handle create group
  const handleCreateGroup = async () => {
    try {
      // Prepare data, excluding teamId if null or type is personal
      const payload = {
        name: createForm.name,
        description: createForm.description,
        color: createForm.color,
        icon: createForm.icon,
        type: createForm.type
      };

      // Only include teamId for team groups when it has a value
      if (createForm.type === 'team' && createForm.teamId) {
        payload.teamId = createForm.teamId;
      }

      await domainGroupAPI.create(payload);
      await fetchGroups();
      setShowCreateModal(false);
      setCreateForm({
        name: '',
        description: '',
        color: '#9D4EDD',
        icon: '📁',
        type: 'personal',
        teamId: null
      });
    } catch (error) {
      console.error('Error creating group:', error);
      alert(error.response?.data?.message || 'Failed to create group');
    }
  };

  // Handle update group
  const handleUpdateGroup = async () => {
    try {
      const response = await domainGroupAPI.update(selectedGroup.id, editForm);
      await fetchGroups();
      if (response.data?.group) {
        setSelectedGroup(response.data.group);
      } else {
        setSelectedGroup({ ...selectedGroup, ...editForm });
      }
      setShowEditModal(false);
    } catch (error) {
      console.error('Error updating group:', error);
      alert(error.response?.data?.message || 'Failed to update group');
    }
  };

  // Handle delete group
  const handleDeleteGroup = async () => {
    if (!confirm(`Are you sure you want to delete the group "${selectedGroup.name}"? Domains will not be deleted, only removed from this group.`)) {
      return;
    }

    try {
      await domainGroupAPI.delete(selectedGroup.id);
      await fetchGroups();
      setSelectedGroup(null);
    } catch (error) {
      console.error('Error deleting group:', error);
      alert(error.response?.data?.message || 'Failed to delete group');
    }
  };

  // Handle add domains to group
  const handleAddDomains = async () => {
    if (selectedDomains.length === 0) {
      alert('Please select at least one domain');
      return;
    }

    try {
      await domainGroupAPI.bulkAssignDomains(selectedGroup.id, selectedDomains);
      await refreshSelectedGroup(selectedGroup.id);
      await fetchGroups();
      setShowAddDomainsModal(false);
      setSelectedDomains([]);
    } catch (error) {
      console.error('Error adding domains:', error);
      alert(error.response?.data?.message || 'Failed to add domains');
    }
  };

  // Handle remove domain from group
  const handleRemoveDomain = async (domainId) => {
    if (!confirm('Remove this domain from the group?')) {
      return;
    }

    try {
      await domainGroupAPI.removeDomain(selectedGroup.id, domainId);
      await refreshSelectedGroup(selectedGroup.id);
      await fetchGroups();
    } catch (error) {
      console.error('Error removing domain:', error);
      alert(error.response?.data?.message || 'Failed to remove domain');
    }
  };

  // Handle add member to team group
  const handleAddMember = async () => {
    if (selectedTeamMembers.length === 0) {
      alert('Please select at least one member');
      return;
    }

    try {
      for (const memberId of selectedTeamMembers) {
        await domainGroupAPI.addMember(selectedGroup.id, memberId, memberPermissions);
      }
      await refreshSelectedGroup(selectedGroup.id);
      setShowAddMemberModal(false);
      setSelectedTeamMembers([]);
      setMemberPermissions({
        canManageGroup: false,
        canAssignDomains: false,
        canViewDomains: true
      });
    } catch (error) {
      console.error('Error adding member:', error);
      alert(error.response?.data?.message || 'Failed to add member');
    }
  };

  // Handle remove member
  const handleRemoveMember = async (memberId) => {
    if (!confirm('Remove this member from the group?')) {
      return;
    }

    try {
      await domainGroupAPI.removeMember(selectedGroup.id, memberId);
      await refreshSelectedGroup(selectedGroup.id);
    } catch (error) {
      console.error('Error removing member:', error);
      alert(error.response?.data?.message || 'Failed to remove member');
    }
  };

  // Open add domains modal and fetch available domains
  const openAddDomainsModal = async () => {
    try {
      const response = await domainAPI.list();
      const allDomains = response.data.domains || [];

      // Filter domains that are not already in ANY group
      const available = allDomains.filter(domain => {
        // Exclude domains that are already in a group (including this one)
        if (domain.groups && domain.groups.length > 0) {
          return false;
        }

        // Personal groups: can contain all domains user has access to
        if (selectedGroup.ownership_type === 'personal') {
          return true; // User can only see domains they have access to
        }

        // Team groups: can contain team domains + your personal domains
        // Personal domains will only be visible to you in the team group
        if (selectedGroup.ownership_type === 'team') {
          const isTeamDomain = domain.team_id === selectedGroup.team_id;
          const isMyPersonalDomain = domain.ownership_type === 'personal';
          return isTeamDomain || isMyPersonalDomain;
        }

        return false;
      });

      setAvailableDomains(available);
      setShowAddDomainsModal(true);
    } catch (error) {
      console.error('Error fetching domains:', error);
    }
  };

  // Open add member modal and fetch team members
  const openAddMemberModal = async () => {
    setShowAddMemberModal(true);
  };

  // Open edit modal
  const openEditModal = () => {
    setEditForm({
      name: selectedGroup.name,
      description: selectedGroup.description || '',
      color: selectedGroup.color,
      icon: selectedGroup.icon || '📁'
    });
    setShowEditModal(true);
  };

  // Filter groups
  const filteredGroups = groups.filter(group => {
    if (filterOwnership === 'all') return true;
    if (filterOwnership === 'personal') return group.ownership_type === 'personal';
    if (filterOwnership === 'team') return group.ownership_type === 'team';
    return true;
  });

  // Get team members for add member modal
  const getTeamMembers = () => {
    if (!selectedGroup || !selectedGroup.team_id) return [];
    const team = teams.find(t => t.id === selectedGroup.team_id);
    return team?.members || [];
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading groups...</div>
      </div>
    );
  }

  // Groups List View
  if (!selectedGroup) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div className="page-header-inner">
            <div className="animate-fade-in flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Domain Groups</h1>
                <p className="text-xs text-white/50 font-light tracking-wide">Organize your domains into groups</p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary flex items-center gap-2 text-xs px-4 py-2.5"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                Create Group
              </button>
            </div>

            {/* Filters */}
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-white/40">Filter</span>
              <button
                onClick={() => setFilterOwnership('all')}
                className={filterOwnership === 'all' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
              >
                All
              </button>
              <button
                onClick={() => setFilterOwnership('personal')}
                className={filterOwnership === 'personal' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
              >
                Personal
              </button>
              <button
                onClick={() => setFilterOwnership('team')}
                className={filterOwnership === 'team' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
              >
                Team
              </button>
            </div>
          </div>
        </div>

        <div className="page-body">
          {filteredGroups.length === 0 ? (
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-12 text-center">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center mx-auto mb-4">
                <Folder className="w-8 h-8 text-[#C77DFF]" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-light text-white mb-2">No Groups Yet</h3>
              <p className="text-xs text-white/50 font-light mb-6 max-w-md mx-auto">
                Create groups to organize your domains by project, environment, or any category you choose
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                Create Your First Group
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGroups.map((group, index) => (
                <div
                  key={group.id}
                  className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-5 hover:border-[#9D4EDD]/30 transition-all duration-500 cursor-pointer animate-fade-in"
                  style={{ animationDelay: `${index * 0.05}s` }}
                  onClick={() => setSelectedGroup(group)}
                >
                  <div className="flex items-start gap-3 mb-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{
                        backgroundColor: `${group.color}15`
                      }}
                    >
                      {group.icon || '📁'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-normal text-white mb-1 truncate">{group.name}</h3>
                      <p className="text-xs text-white/60 font-light capitalize">
                        {group.ownership_type === 'personal' ? 'Personal' : group.team_name}
                      </p>
                    </div>
                  </div>

                  {group.description && (
                    <p className="text-xs text-white/60 font-light mb-4 line-clamp-2">
                      {group.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t border-white/[0.08]">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-white/40" strokeWidth={1.5} />
                      <span className="text-xs text-white/60 font-light">
                        {group.domain_count || 0} {group.domain_count === 1 ? 'domain' : 'domains'}
                      </span>
                    </div>
                    <GroupBadge group={group} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Group Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
            <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-xl font-light text-white mb-2 tracking-tight">Create Group</h2>
              <p className="text-xs text-white/50 mb-5 font-light">Organize your domains into a new group</p>

              <div className="space-y-4">
                {/* Type Selection */}
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Type</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, type: 'personal', teamId: null })}
                      className={createForm.type === 'personal' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}
                    >
                      Personal Group
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, type: 'team' })}
                      className={createForm.type === 'team' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}
                    >
                      Team Group
                    </button>
                  </div>
                </div>

                {/* Team Selection (if type is team) */}
                {createForm.type === 'team' && (
                  <div>
                    <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Select Team</label>
                    <Combobox
                      value={createForm.teamId ? createForm.teamId.toString() : ''}
                      onValueChange={(selectedValue) =>
                        setCreateForm({
                          ...createForm,
                          teamId: selectedValue ? parseInt(selectedValue, 10) : null,
                        })
                      }
                      options={[
                        { value: '', label: 'Choose a team...' },
                        ...teams.map((team) => ({ value: team.id.toString(), label: team.name })),
                      ]}
                      placeholder="Choose a team..."
                      searchPlaceholder="Search team..."
                      emptyText="No team found."
                      triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                      contentClassName="max-h-72"
                    />
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Group Name</label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="e.g., Production, Development, Mail Servers..."
                    className="input-futuristic text-xs"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Description (Optional)</label>
                  <textarea
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    placeholder="What is this group for?"
                    className="input-futuristic text-xs h-20 resize-none"
                  />
                </div>

                {/* Color Picker */}
                <ColorPicker
                  value={createForm.color}
                  onChange={(color) => setCreateForm({ ...createForm, color })}
                  label="Group Color"
                />

                {/* Icon */}
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Icon (Emoji)</label>
                  <input
                    type="text"
                    value={createForm.icon}
                    onChange={(e) => setCreateForm({ ...createForm, icon: e.target.value })}
                    placeholder="📁"
                    maxLength={2}
                    className="input-futuristic text-xs"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2.5 pt-3">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="btn-secondary flex-1 text-xs px-4 py-2.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateGroup}
                    className="btn-primary flex-1 text-xs px-4 py-2.5"
                    disabled={!createForm.name || (createForm.type === 'team' && !createForm.teamId)}
                  >
                    Create Group
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Group Details View
  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in">
            <button
              onClick={() => setSelectedGroup(null)}
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-4 text-xs"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              Back to Groups
            </button>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-4">
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                  style={{
                    backgroundColor: `${selectedGroup.color}15`
                  }}
                >
                  {selectedGroup.icon || '📁'}
                </div>
                <div>
                  <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">{selectedGroup.name}</h1>
                  <p className="text-xs text-white/50 font-light">
                    {selectedGroup.ownership_type === 'personal' ? 'Personal Group' : `Team: ${selectedGroup.team_name}`} • {groupDomains.length} {groupDomains.length === 1 ? 'domain' : 'domains'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={openEditModal}
                  className="btn-secondary flex items-center gap-2 text-xs px-4 py-2.5"
                >
                  <Settings className="w-4 h-4" strokeWidth={1.5} />
                  Edit
                </button>
                {selectedGroup.is_owner && (
                  <button
                    onClick={handleDeleteGroup}
                    className="btn-secondary flex items-center gap-2 text-xs px-4 py-2.5 text-[#F87171] border-[#F87171]/20 hover:bg-[#F87171]/10"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    Delete
                  </button>
                )}
              </div>
            </div>

            {selectedGroup.description && (
              <p className="text-sm text-white/70 font-light mt-4">{selectedGroup.description}</p>
            )}
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Domains Section */}
          <div className="lg:col-span-2">
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg">
              <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-light text-white tracking-tight mb-1">Domains</h2>
                  <p className="text-xs text-white/50 font-light tracking-wide">{groupDomains.length} domains in this group</p>
                </div>
                <button
                  onClick={openAddDomainsModal}
                  className="btn-primary flex items-center gap-2 text-xs px-4 py-2.5"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.5} />
                  Add Domains
                </button>
              </div>

              <div className="p-5">
                {groupDomains.length === 0 ? (
                  <div className="text-center py-8">
                    <Globe className="w-12 h-12 text-white/20 mx-auto mb-3" strokeWidth={1} />
                    <p className="text-xs text-white/40 font-light">No domains in this group yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupDomains.map(domain => (
                      <div key={domain.id} className="bg-white/[0.02] border border-white/[0.08] rounded-lg p-4 flex items-center justify-between hover:bg-white/[0.04] transition-all">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-normal text-white truncate">{domain.hostname}</h3>
                            {selectedGroup.ownership_type === 'team' && domain.ownership_type === 'personal' && (
                              <span className="px-2 py-0.5 bg-[#F59E0B]/20 text-[#FBBf24] rounded-full text-[9px] font-medium whitespace-nowrap" title="Only visible to you">
                                🔒 Private
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-white/50 font-light truncate">{domain.backend_url}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveDomain(domain.id)}
                          className="p-2 text-[#F87171] hover:bg-[#F87171]/10 rounded-lg transition-all ml-3"
                          title="Remove from group"
                        >
                          <X className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Team Members Section (Team Groups Only) */}
          {selectedGroup.ownership_type === 'team' && (
            <div>
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg">
                <div className="p-5 border-b border-white/[0.08]">
                  <div>
                    <h2 className="text-base font-light text-white tracking-tight mb-1">Team Members</h2>
                    <p className="text-xs text-white/50 font-light tracking-wide">
                      All {groupMembers.length} team members have access to this group
                    </p>
                  </div>
                </div>

                <div className="p-5">
                  {groupMembers.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="w-12 h-12 text-white/20 mx-auto mb-3" strokeWidth={1} />
                      <p className="text-xs text-white/40 font-light">No team members</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {groupMembers.map(member => (
                        <div key={member.user_id || member.id} className="bg-white/[0.02] border border-white/[0.08] rounded-lg p-3 flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-normal text-white">{member.display_name || member.username}</h3>
                              {member.role === 'owner' && (
                                <span className="px-2 py-0.5 bg-[#9D4EDD]/20 text-[#C77DFF] rounded-full text-[9px] font-medium">Owner</span>
                              )}
                            </div>
                            <div className="flex gap-1 flex-wrap">
                              {member.can_manage_group && <span className="badge-success text-[9px]">Can Manage</span>}
                              {member.can_assign_domains && <span className="badge-primary text-[9px]">Can Assign Domains</span>}
                              <span className="badge-secondary text-[9px]">Can View</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-5 border-t border-white/[0.08] bg-[#06B6D4]/5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-[#22D3EE]" strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="text-xs text-[#22D3EE] font-medium mb-1">Team Group Access</p>
                      <p className="text-xs text-white/60 font-light leading-relaxed">
                        This group belongs to the entire team. All team members can view it automatically.
                        Permissions are based on team roles. Manage team members in the Teams section.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Domains Modal */}
      {showAddDomainsModal && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowAddDomainsModal(false)}>
          <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">Add Domains to Group</h2>
            <p className="text-xs text-white/50 mb-5 font-light">Select domains to add to {selectedGroup.name}</p>

            {selectedGroup.ownership_type === 'team' && (
              <div className="mb-5 p-4 bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">🔒</span>
                  </div>
                  <div>
                    <p className="text-xs text-[#FBBf24] font-medium mb-1">Privacy Note</p>
                    <p className="text-xs text-white/60 font-light leading-relaxed">
                      <strong>Team domains</strong> will be visible to all team members.
                      <strong> Your personal domains</strong> will only be visible to you (marked as Private).
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 mb-5 max-h-96 overflow-y-auto">
              {availableDomains.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-8">No available domains to add</p>
              ) : (
                availableDomains.map(domain => (
                  <label key={domain.id} className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/[0.08] rounded-lg hover:bg-white/[0.04] cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={selectedDomains.includes(domain.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDomains([...selectedDomains, domain.id]);
                        } else {
                          setSelectedDomains(selectedDomains.filter(id => id !== domain.id));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white">{domain.hostname}</p>
                        {selectedGroup.ownership_type === 'team' && domain.ownership_type === 'personal' && (
                          <span className="px-2 py-0.5 bg-[#F59E0B]/20 text-[#FBBf24] rounded-full text-[9px] font-medium" title="Will be private - only visible to you">
                            🔒 Private
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/50">{domain.backend_url}</p>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setShowAddDomainsModal(false)}
                className="btn-secondary flex-1 text-xs px-4 py-2.5"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDomains}
                className="btn-primary flex-1 text-xs px-4 py-2.5"
                disabled={selectedDomains.length === 0}
              >
                Add {selectedDomains.length} {selectedDomains.length === 1 ? 'Domain' : 'Domains'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowAddMemberModal(false)}>
          <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">Add Members to Group</h2>
            <p className="text-xs text-white/50 mb-5 font-light">Grant team members specific permissions for this group</p>

            {/* Permissions */}
            <div className="mb-5 p-4 bg-white/[0.02] border border-white/[0.08] rounded-lg">
              <h3 className="text-xs font-medium text-white mb-3">Permissions</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberPermissions.canManageGroup}
                    onChange={(e) => setMemberPermissions({ ...memberPermissions, canManageGroup: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-white">Can manage group settings</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberPermissions.canAssignDomains}
                    onChange={(e) => setMemberPermissions({ ...memberPermissions, canAssignDomains: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-white">Can add/remove domains</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberPermissions.canViewDomains}
                    onChange={(e) => setMemberPermissions({ ...memberPermissions, canViewDomains: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-white">Can view domains</span>
                </label>
              </div>
            </div>

            {/* Team Members List */}
            <div className="space-y-3 mb-5 max-h-64 overflow-y-auto">
              {getTeamMembers().map(member => (
                <label key={member.user_id} className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/[0.08] rounded-lg hover:bg-white/[0.04] cursor-pointer transition-all">
                  <input
                    type="checkbox"
                    checked={selectedTeamMembers.includes(member.user_id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTeamMembers([...selectedTeamMembers, member.user_id]);
                      } else {
                        setSelectedTeamMembers(selectedTeamMembers.filter(id => id !== member.user_id));
                      }
                    }}
                    className="w-4 h-4"
                  />
                  <div className="flex-1">
                    <p className="text-sm text-white">{member.display_name || member.username}</p>
                    <p className="text-xs text-white/50">{member.email}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="btn-secondary flex-1 text-xs px-4 py-2.5"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                className="btn-primary flex-1 text-xs px-4 py-2.5"
                disabled={selectedTeamMembers.length === 0}
              >
                Add {selectedTeamMembers.length} {selectedTeamMembers.length === 1 ? 'Member' : 'Members'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowEditModal(false)}>
          <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">Edit Group</h2>
            <p className="text-xs text-white/50 mb-5 font-light">Update group settings</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Group Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="input-futuristic text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="input-futuristic text-xs h-20 resize-none"
                />
              </div>

              <ColorPicker
                value={editForm.color}
                onChange={(color) => setEditForm({ ...editForm, color })}
                label="Group Color"
              />

              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Icon (Emoji)</label>
                <input
                  type="text"
                  value={editForm.icon}
                  onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })}
                  maxLength={2}
                  className="input-futuristic text-xs"
                />
              </div>

              <div className="flex gap-2.5 pt-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateGroup}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                  disabled={!editForm.name}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
