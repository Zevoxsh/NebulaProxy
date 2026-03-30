import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, AlertCircle, Loader2, Search, Filter, Users, X, CheckCircle, Shield, RefreshCw, BarChart3, ArrowLeft, Folder, MoreVertical, Edit, Trash2, Settings, Globe } from 'lucide-react';
import { domainAPI, sslAPI, domainGroupAPI, teamAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import DomainForm from '../components/features/DomainForm';
import GroupBadge from '../components/ui/GroupBadge';
import { Combobox } from '../components/ui/combobox';

export default function Domains() {
  const ownershipOptions = [
    { value: 'all', label: 'All Ownership' },
    { value: 'personal', label: 'Personal' },
    { value: 'team', label: 'Team' },
  ];

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'http', label: 'HTTP/HTTPS' },
    { value: 'tcp', label: 'TCP' },
    { value: 'udp', label: 'UDP' },
    { value: 'minecraft', label: 'Minecraft' },
  ];

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'active', label: 'Active Only' },
    { value: 'inactive', label: 'Inactive Only' },
    { value: 'ssl', label: 'SSL Enabled' },
  ];

  const navigate = useNavigate();
  const { groupId } = useParams();
  const [domains, setDomains] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingDomain, setEditingDomain] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [quota, setQuota] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [routingChecks, setRoutingChecks] = useState({});
  const itemsPerPage = 10;
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupDomains, setGroupDomains] = useState([]);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [createGroupForm, setCreateGroupForm] = useState({
    name: '',
    description: '',
    color: '#9D4EDD',
    icon: '📁',
    type: 'personal',
    teamId: null
  });
  const [teams, setTeams] = useState([]);

  // Context Menu states
  const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, group: null });

  // Add Domains Modal states
  const [showAddDomainsModal, setShowAddDomainsModal] = useState(false);
  const [selectedGroupForDomains, setSelectedGroupForDomains] = useState(null);
  const [availableDomains, setAvailableDomains] = useState([]);
  const [selectedDomainIds, setSelectedDomainIds] = useState([]);
  const [addingDomains, setAddingDomains] = useState(false);

  // Edit Group Modal states
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [editGroupForm, setEditGroupForm] = useState({
    name: '',
    description: '',
    color: '#9D4EDD',
    icon: '📁'
  });

  // Add to Group Modal states
  const [showAddToGroupModal, setShowAddToGroupModal] = useState(false);
  const [selectedDomainForGroup, setSelectedDomainForGroup] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  // DNS Challenge states
  const [showDNSModal, setShowDNSModal] = useState(false);
  const [dnsChallenge, setDnsChallenge] = useState(null);
  const [dnsValidating, setDnsValidating] = useState(false);
  const [dnsCheckingPropagation, setDnsCheckingPropagation] = useState(false);
  const [dnsPropagated, setDnsPropagated] = useState(false);
  const [dnsError, setDnsError] = useState(null);
  const [selectedDomainForDNS, setSelectedDomainForDNS] = useState(null);

  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    fetchDomains();
    fetchGroups();
    fetchTeams();
  }, []);

  // Load group from URL if groupId is present
  useEffect(() => {
    const loadGroupFromUrl = async () => {
      if (groupId && groups.length > 0) {
        const group = groups.find(g => g.id === parseInt(groupId));
        if (group) {
          setSelectedGroup(group);
          setGroupDomains([]);
          setLoading(true);
          await fetchGroupDomains(group.id);
          setLoading(false);
        } else {
          // Group not found, redirect to domains list
          navigate('/domains', { replace: true });
        }
      } else if (!groupId && selectedGroup) {
        // No groupId in URL but group is selected, clear selection
        setSelectedGroup(null);
        setGroupDomains([]);
      }
    };

    loadGroupFromUrl();
  }, [groupId, groups]);

  const fetchGroups = async () => {
    try {
      const response = await domainGroupAPI.list();
      setGroups(response.data.groups || []);
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    }
  };

  const fetchGroupDomains = async (groupId) => {
    try {
      const response = await domainGroupAPI.get(groupId);
      const domains = response.data.group?.domains || [];
      setGroupDomains(domains);
    } catch (err) {
      console.error('Failed to fetch group domains:', err);
      setError('Failed to load group domains');
    }
  };

  const refreshSelectedGroup = async (groupId) => {
    if (!groupId) return;
    try {
      const response = await domainGroupAPI.get(groupId);
      setGroupDomains(response.data.group.domains || []);
      setSelectedGroup((prev) => (prev && prev.id === groupId ? { ...prev, ...response.data.group } : prev));
    } catch (err) {
      console.error('Failed to refresh group details:', err);
    }
  };

  const handleGroupClick = (group) => {
    navigate(`/domains/groups/${group.id}`);
  };

  const handleBackFromGroup = () => {
    navigate('/domains');
  };

  const fetchTeams = async () => {
    try {
      const response = await teamAPI.list();
      setTeams(response.data.teams || []);
    } catch (error) {
      console.error('Error fetching teams:', error);
    }
  };

  const handleCreateGroup = async () => {
    try {
      const payload = {
        name: createGroupForm.name,
        description: createGroupForm.description,
        color: createGroupForm.color,
        icon: createGroupForm.icon,
        type: createGroupForm.type
      };

      if (createGroupForm.type === 'team' && createGroupForm.teamId) {
        payload.teamId = createGroupForm.teamId;
      }

      await domainGroupAPI.create(payload);
      await fetchGroups(); // Refresh groups
      setShowCreateGroupModal(false);
      setSuccess('Group created successfully');
      setTimeout(() => setSuccess(''), 3000);
      setCreateGroupForm({
        name: '',
        description: '',
        color: '#9D4EDD',
        icon: '📁',
        type: 'personal',
        teamId: null
      });
    } catch (error) {
      console.error('Error creating group:', error);
      setError(error.response?.data?.message || 'Failed to create group');
    }
  };

  const handleGroupRightClick = (e, group) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      group: group
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ show: false, x: 0, y: 0, group: null });
  };

  const handleOpenAddDomains = async (groupToUse = null) => {
    const group = groupToUse || contextMenu.group;
    if (!group) return;

    if (contextMenu.show) {
      closeContextMenu();
    }

    setSelectedGroupForDomains(group);

    // Fetch domains available for this group
    try {
      const response = await domainAPI.list();
      const allDomains = response.data.domains;

      // Filter: only show domains not already in any group
      let available = allDomains.filter(domain => !domain.groups || domain.groups.length === 0);

      // If team group, only show personal domains + domains from the same team
      if (group.ownership_type === 'team' && group.team_id) {
        available = available.filter(domain =>
          domain.ownership_type === 'personal' ||
          (domain.ownership_type === 'team' && domain.team_id === group.team_id)
        );
      }

      setAvailableDomains(available);
      setSelectedDomainIds([]);
      setShowAddDomainsModal(true);
    } catch (error) {
      console.error('Error fetching domains:', error);
      setError('Failed to load available domains');
    }
  };

  const handleAddDomainsToGroup = async () => {
    if (selectedDomainIds.length === 0) return;

    setAddingDomains(true);
    try {
      // Add each selected domain to the group
      await Promise.all(
        selectedDomainIds.map(domainId =>
          domainGroupAPI.assignDomain(selectedGroupForDomains.id, domainId)
        )
      );

      setSuccess(`${selectedDomainIds.length} domain(s) added to group`);
      setTimeout(() => setSuccess(''), 3000);
      setShowAddDomainsModal(false);
      await fetchDomains(); // Refresh to update groups
      await fetchGroups(); // Refresh group counts
      if (selectedGroup && selectedGroupForDomains && selectedGroup.id === selectedGroupForDomains.id) {
        await refreshSelectedGroup(selectedGroup.id);
      }
    } catch (error) {
      console.error('Error adding domains to group:', error);
      setError(error.response?.data?.message || 'Failed to add domains to group');
    } finally {
      setAddingDomains(false);
    }
  };

  const handleOpenEditGroup = () => {
    const group = contextMenu.group;
    closeContextMenu();

    setEditingGroup(group);
    setEditGroupForm({
      name: group.name,
      description: group.description || '',
      color: group.color || '#9D4EDD',
      icon: group.icon || '📁'
    });
    setShowEditGroupModal(true);
  };

  const handleEditGroup = async () => {
    if (!editingGroup) return;

    try {
      const response = await domainGroupAPI.update(editingGroup.id, editGroupForm);
      setSuccess('Group updated successfully');
      setTimeout(() => setSuccess(''), 3000);
      setShowEditGroupModal(false);
      setEditingGroup(null);
      await fetchGroups(); // Refresh groups
      if (selectedGroup && selectedGroup.id === editingGroup.id) {
        setSelectedGroup((prev) => (prev ? { ...prev, ...response.data.group } : prev));
      }
    } catch (error) {
      console.error('Error updating group:', error);
      setError(error.response?.data?.message || 'Failed to update group');
    }
  };

  const handleDeleteGroup = async () => {
    const group = contextMenu.group;
    closeContextMenu();

    if (!confirm(`Are you sure you want to delete the group "${group.name}"? Domains will not be deleted, only ungrouped.`)) {
      return;
    }

    try {
      await domainGroupAPI.delete(group.id);
      setSuccess('Group deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
      await fetchGroups(); // Refresh groups
      await fetchDomains(); // Refresh domains to update group assignments
    } catch (error) {
      console.error('Error deleting group:', error);
      setError(error.response?.data?.message || 'Failed to delete group');
    }
  };

  const handleRemoveDomainFromGroup = async (domainId) => {
    if (!selectedGroup) return;

    if (!confirm('Remove this domain from the group?')) {
      return;
    }

    try {
      await domainGroupAPI.removeDomain(selectedGroup.id, domainId);
      setSuccess('Domain removed from group');
      setTimeout(() => setSuccess(''), 3000);
      await refreshSelectedGroup(selectedGroup.id); // Refresh group view
      await fetchGroups(); // Refresh group counts
      await fetchDomains(); // Refresh main domain list
    } catch (error) {
      console.error('Error removing domain from group:', error);
      setError(error.response?.data?.message || 'Failed to remove domain from group');
    }
  };

  const handleOpenAddToGroup = (domain) => {
    setSelectedDomainForGroup(domain);
    setSelectedGroupId(null);
    setShowAddToGroupModal(true);
  };

  const handleAddDomainToGroup = async () => {
    if (!selectedGroupId || !selectedDomainForGroup) return;

    try {
      await domainGroupAPI.assignDomain(selectedGroupId, selectedDomainForGroup.id);
      setSuccess('Domain added to group');
      setTimeout(() => setSuccess(''), 3000);
      setShowAddToGroupModal(false);
      await fetchDomains(); // Refresh domains
      await fetchGroups(); // Refresh group counts
      if (selectedGroup && selectedGroup.id === selectedGroupId) {
        await refreshSelectedGroup(selectedGroup.id);
      }
    } catch (error) {
      console.error('Error adding domain to group:', error);
      setError(error.response?.data?.message || 'Failed to add domain to group');
    }
  };

  const fetchDomains = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await domainAPI.list();
      setDomains(response.data.domains);
      runRoutingChecks(response.data.domains);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load domains');
    } finally {
      setLoading(false);
    }
  };

  const runRoutingChecks = async (domainList) => {
    const httpDomains = domainList.filter((domain) => !domain.proxy_type || domain.proxy_type === 'http');

    httpDomains.forEach((domain) => {
      setRoutingChecks((prev) => ({
        ...prev,
        [domain.id]: { status: 'loading' }
      }));
    });

    const results = await Promise.allSettled(
      httpDomains.map((domain) => domainAPI.checkRouting(domain.id))
    );

    results.forEach((result, index) => {
      const domain = httpDomains[index];
      if (!domain) return;

      if (result.status === 'fulfilled') {
        const data = result.value.data;
        setRoutingChecks((prev) => ({
          ...prev,
          [domain.id]: {
            status: data.ok ? 'ok' : 'fail',
            message: data.message
          }
        }));
      } else {
        setRoutingChecks((prev) => ({
          ...prev,
          [domain.id]: {
            status: 'fail',
            message: 'Routing check failed'
          }
        }));
      }
    });
  };

  const handleRoutingCheck = async (domain) => {
    if (domain.proxy_type && domain.proxy_type !== 'http') return;

    setRoutingChecks((prev) => ({
      ...prev,
      [domain.id]: { status: 'loading' }
    }));

    try {
      const response = await domainAPI.checkRouting(domain.id);
      setRoutingChecks((prev) => ({
        ...prev,
        [domain.id]: {
          status: response.data.ok ? 'ok' : 'fail',
          message: response.data.message
        }
      }));
    } catch (error) {
      setRoutingChecks((prev) => ({
        ...prev,
        [domain.id]: {
          status: 'fail',
          message: 'Routing check failed'
        }
      }));
    }
  };

  const handleAddDomain = async (formData) => {
    try {
      setSubmitting(true);
      setError('');

      const payload = {
        hostname: formData.hostname,
        backendUrl: formData.backendUrl,
        backendPort: formData.backendPort || undefined,
        description: formData.description || undefined,
        proxyType: formData.proxyType,
        sslEnabled: Boolean(formData.sslEnabled),
        challengeType: formData.challengeType
      };
      if (formData.proxyType === 'tcp' || formData.proxyType === 'udp' || formData.proxyType === 'minecraft') {
        let protocol;
        if (formData.proxyType === 'minecraft') {
          protocol = formData.minecraftEdition === 'bedrock' ? 'udp' : 'tcp';
        } else {
          protocol = formData.proxyType;
        }
        if (!formData.backendUrl.includes('://')) {
          payload.backendUrl = `${protocol}://${formData.backendUrl}`;
        }
      }
      if (formData.proxyType === 'minecraft' && formData.minecraftEdition) {
        payload.minecraftEdition = formData.minecraftEdition;
      }
      if (user?.role !== 'admin' || !formData.externalPort) {
        delete payload.externalPort;
      } else {
        payload.externalPort = Number(formData.externalPort);
      }

      const response = await domainAPI.create(payload);
      const newDomainId = response.data.domain.id;

      if (response.data.quota) {
        setQuota(response.data.quota);
      }

      setDomains([response.data.domain, ...domains]);
      setShowForm(false);

      // If we're currently viewing a group, automatically add the new domain to it
      if (selectedGroup) {
        try {
          await domainGroupAPI.assignDomain(selectedGroup.id, newDomainId);
          await refreshSelectedGroup(selectedGroup.id);
          setSuccess(`Domain created and added to "${selectedGroup.name}"`);
        } catch (assignErr) {
          console.error('Failed to assign new domain to current group:', assignErr);
          setSuccess('Domain created (could not add to group automatically)');
        }
      } else {
        setSuccess('Domain created successfully');
      }
      setTimeout(() => setSuccess(''), 3000);

      // Refresh groups list
      await fetchGroups();

      // Handle Load Balancing after domain creation
      if (formData.loadBalancingEnabled || formData.additionalBackends?.length > 0) {
        try {
          // Update load balancing settings
          await domainAPI.updateLoadBalancing(newDomainId, {
            enabled: formData.loadBalancingEnabled,
            algorithm: formData.loadBalancingAlgorithm
          });

          // Add additional backends
          for (const backend of (formData.additionalBackends || [])) {
            if (backend.url) {
              await domainAPI.createBackend(newDomainId, {
                backendUrl: backend.url,
                backendPort: backend.port || null
              });
            }
          }
        } catch (lbErr) {
          console.error('Load balancing setup failed:', lbErr);
          setError(`Domain created but load balancing setup failed: ${lbErr.response?.data?.message || 'Unknown error'}`);
        }
      }

      // If custom certificate, upload it
      if (formData.sslEnabled && formData.challengeType === 'custom') {
        try {
          await sslAPI.upload({
            domainId: newDomainId,
            fullChain: formData.fullChain,
            privateKey: formData.privateKey
          });
          setSuccess('Domain created and custom certificate uploaded successfully');
          setTimeout(() => setSuccess(''), 3000);
          fetchDomains(); // Refresh to show updated SSL status
        } catch (uploadErr) {
          setError(`Domain created but certificate upload failed: ${uploadErr.response?.data?.message || 'Unknown error'}`);
        }
      }
      // If DNS-01 challenge, automatically request DNS certificate
      else if (formData.sslEnabled && formData.challengeType === 'dns-01') {
        handleRequestDNSCertificate(newDomainId);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create domain');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditDomain = async (formData) => {
    try {
      setSubmitting(true);
      setError('');

      const payload = {
        hostname: formData.hostname,
        backendUrl: formData.backendUrl,
        backendPort: formData.backendPort || undefined,
        description: formData.description || undefined,
        proxyType: formData.proxyType,
        sslEnabled: Boolean(formData.sslEnabled)
      };
      if (formData.proxyType === 'tcp' || formData.proxyType === 'udp' || formData.proxyType === 'minecraft') {
        let protocol;
        if (formData.proxyType === 'minecraft') {
          const edition = formData.minecraftEdition || editingDomain?.minecraft_edition || 'java';
          protocol = edition === 'bedrock' ? 'udp' : 'tcp';
        } else {
          protocol = formData.proxyType;
        }
        if (!formData.backendUrl.includes('://')) {
          payload.backendUrl = `${protocol}://${formData.backendUrl}`;
        }
      }
      if (user?.role !== 'admin' || !formData.externalPort) {
        delete payload.externalPort;
      } else {
        payload.externalPort = Number(formData.externalPort);
      }

      const response = await domainAPI.update(editingDomain.id, payload);

      // Handle Load Balancing updates
      try {
        // Update load balancing settings
        await domainAPI.updateLoadBalancing(editingDomain.id, {
          enabled: formData.loadBalancingEnabled,
          algorithm: formData.loadBalancingAlgorithm
        });

        // Get existing backends to compare
        const existingBackendsRes = await domainAPI.getBackends(editingDomain.id);
        const existingBackends = existingBackendsRes.data.backends || [];
        const existingBackendIds = new Set(existingBackends.map(b => b.id));

        // Process backends from form
        const formBackendIds = new Set();
        for (const backend of (formData.additionalBackends || [])) {
          if (backend.id) {
            // Existing backend - update if needed
            formBackendIds.add(backend.id);
            await domainAPI.updateBackend(editingDomain.id, backend.id, {
              backendUrl: backend.url,
              backendPort: backend.port || null
            });
          } else if (backend.url) {
            // New backend - create
            await domainAPI.createBackend(editingDomain.id, {
              backendUrl: backend.url,
              backendPort: backend.port || null
            });
          }
        }

        // Delete backends that were removed
        for (const existingId of existingBackendIds) {
          if (!formBackendIds.has(existingId)) {
            await domainAPI.deleteBackend(editingDomain.id, existingId);
          }
        }
      } catch (lbErr) {
        console.error('Load balancing update failed:', lbErr);
        // Don't fail the whole update, just log
      }

      setDomains(domains.map(d =>
        d.id === editingDomain.id ? response.data.domain : d
      ));
      setShowForm(false);
      setEditingDomain(null);
      setSuccess('Domain updated successfully');
      setTimeout(() => setSuccess(''), 3000);

      // Refresh group view if we're in a group
      if (selectedGroup) {
        await refreshSelectedGroup(selectedGroup.id);
      }
      // Refresh groups list to update domain info
      await fetchGroups();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update domain');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDomain = async (domain) => {
    if (!confirm(`Are you sure you want to delete ${domain.hostname}?`)) {
      return;
    }

    try {
      await domainAPI.delete(domain.id);
      setDomains(domains.filter(d => d.id !== domain.id));
      setSuccess('Domain deleted successfully');
      setTimeout(() => setSuccess(''), 3000);

      // Refresh group view if we're in a group
      if (selectedGroup) {
        await refreshSelectedGroup(selectedGroup.id);
      }
      // Refresh groups list to update domain counts
      await fetchGroups();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete domain');
    }
  };

  const handleToggleDomain = async (domain) => {
    try {
      const response = await domainAPI.toggle(domain.id);
      setDomains(domains.map(d =>
        d.id === domain.id ? response.data.domain : d
      ));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle domain');
    }
  };

  const handleToggleSSL = async (domain) => {
    try {
      const response = await domainAPI.update(domain.id, { sslEnabled: !domain.ssl_enabled });
      setDomains(domains.map(d =>
        d.id === domain.id ? response.data.domain : d
      ));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update SSL');
    }
  };

  // DNS Challenge Handlers
  const handleRequestDNSCertificate = async (domainId) => {
    setDnsError(null);
    setShowDNSModal(true);
    setSelectedDomainForDNS(domainId);
    setDnsPropagated(false);

    try {
      const response = await sslAPI.requestDNS(domainId);

      if (response.data.success) {
        // Certificate already valid
        if (response.data.certificateExists) {
          setShowDNSModal(false);
          setSuccess(`Certificate already valid (${response.data.daysRemaining} days remaining)`);
          setTimeout(() => setSuccess(''), 5000);
          await fetchDomains(); // Refresh list
          return;
        }

        // Certificate obtained via HTTP-01
        if (response.data.certificateObtained) {
          setShowDNSModal(false);
          setSuccess(`Certificate obtained successfully! (${response.data.method})`);
          setTimeout(() => setSuccess(''), 5000);
          await fetchDomains(); // Refresh list
          return;
        }

        // DNS challenge initiated
        if (response.data.challenge) {
          setDnsChallenge(response.data.challenge);

          if (response.data.alreadyPending) {
            console.log('Using existing DNS challenge');
          }
        }
      }
    } catch (error) {
      console.error('Error requesting DNS challenge:', error);
      setShowDNSModal(false);
      setError(error.response?.data?.message || 'Failed to initiate DNS challenge');
    }
  };

  const handleCheckDNSPropagation = async () => {
    if (!selectedDomainForDNS) return;

    setDnsCheckingPropagation(true);

    try {
      const response = await sslAPI.checkDNSPropagation(selectedDomainForDNS);

      if (response.data.propagated) {
        setDnsPropagated(true);
        setDnsError(null);
      } else {
        setDnsPropagated(false);
        setDnsError('DNS record not yet propagated. Please wait and try again.');
      }
    } catch (error) {
      console.error('Error checking DNS propagation:', error);
      setDnsError('Failed to check DNS propagation');
    } finally {
      setDnsCheckingPropagation(false);
    }
  };

  const handleValidateDNS = async () => {
    if (!selectedDomainForDNS) return;

    setDnsValidating(true);
    setDnsError(null);

    try {
      const response = await sslAPI.validateDNS(selectedDomainForDNS, true);

      if (response.data.success) {
        // Certificate obtained successfully
        await fetchDomains(); // Refresh list
        setShowDNSModal(false);
        setDnsChallenge(null);
        setSelectedDomainForDNS(null);

        // Show success notification
        setSuccess('SSL Certificate obtained successfully!');
        setTimeout(() => setSuccess(''), 5000);
      } else if (response.data.propagated === false) {
        setDnsError(response.data.message);
      }
    } catch (error) {
      console.error('Error validating DNS challenge:', error);
      setDnsError(error.response?.data?.message || 'DNS validation failed');
    } finally {
      setDnsValidating(false);
    }
  };

  const handleCloseDNSModal = async () => {
    // Cancel backend DNS challenge if one is in progress
    if (selectedDomainForDNS) {
      try {
        await sslAPI.cancelDNS(selectedDomainForDNS);
        console.log('DNS challenge cancelled');
      } catch (error) {
        console.error('Failed to cancel DNS challenge:', error);
      }
    }

    setShowDNSModal(false);
    setDnsChallenge(null);
    setDnsError(null);
    setSelectedDomainForDNS(null);
    setDnsPropagated(false);
  };

  const openEditForm = (domain) => {
    setEditingDomain(domain);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingDomain(null);
    setError('');
  };

  const userDomains = domains.filter(d => !d.username || d.username === user?.username);
  const quotaUsed = userDomains.length;
  const quotaMax = quota?.max || user?.maxDomains || 5;
  const isUnlimited = quotaMax >= 999 || user?.role === 'admin';
  const quotaPercentage = isUnlimited ? 0 : (quotaUsed / quotaMax) * 100;

  // Separate ungrouped domains (domains not in any group)
  const ungroupedDomains = domains.filter(domain => !domain.groups || domain.groups.length === 0);

  // Filter and search logic for ungrouped domains
  const filteredDomains = ungroupedDomains.filter(domain => {
    const matchesSearch =
      domain.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      domain.backend_url?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      domain.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter =
      filterStatus === 'all' ||
      (filterStatus === 'active' && domain.is_active) ||
      (filterStatus === 'inactive' && !domain.is_active) ||
      (filterStatus === 'ssl' && domain.ssl_enabled);

    const matchesOwnership =
      ownershipFilter === 'all' ||
      (ownershipFilter === 'personal' && domain.ownership_type !== 'team') ||
      (ownershipFilter === 'team' && domain.ownership_type === 'team');

    const matchesType =
      typeFilter === 'all' ||
      (typeFilter === 'http' && (!domain.proxy_type || domain.proxy_type === 'http')) ||
      (typeFilter === 'tcp' && domain.proxy_type === 'tcp') ||
      (typeFilter === 'udp' && domain.proxy_type === 'udp') ||
      (typeFilter === 'minecraft' && domain.proxy_type === 'minecraft');

    return matchesSearch && matchesFilter && matchesOwnership && matchesType;
  });

  // Filter groups based on search
  const filteredGroups = groups.filter(group => {
    if (!searchTerm) return true;
    return group.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           group.description?.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredDomains.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedDomains = filteredDomains.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus, ownershipFilter, typeFilter, groupFilter]);

  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu.show) {
      const handleClick = () => closeContextMenu();
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.show]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          {/* Header */}
          <div className="mb-4 animate-fade-in flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Domain Management</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">
                {quotaUsed} / {isUnlimited ? 'Unlimited' : quotaMax} domains
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateGroupModal(true)}
                className="btn-secondary flex items-center gap-2 text-xs px-4"
              >
                <Folder className="w-4 h-4" strokeWidth={1.5} />
                Create Group
              </button>
              <button
                onClick={() => setShowForm(true)}
                disabled={!isUnlimited && quotaUsed >= quotaMax}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                Add Domain
              </button>
            </div>
          </div>

          {/* Search and Filters - Compact Design */}
          <div className="flex flex-col md:flex-row gap-3 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            {/* Search Bar */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search domains and groups..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-futuristic pl-10 text-xs w-full"
              />
            </div>

            {/* Compact Filter Dropdowns */}
            <div className="flex gap-2 flex-wrap md:flex-nowrap">
              {/* Ownership Filter */}
              <div className="min-w-[150px]">
                <Combobox
                  value={ownershipFilter}
                  onValueChange={setOwnershipFilter}
                  options={ownershipOptions}
                  placeholder="All Ownership"
                  searchPlaceholder="Search ownership..."
                  emptyText="No ownership found."
                  triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>

              {/* Type Filter */}
              <div className="min-w-[170px]">
                <Combobox
                  value={typeFilter}
                  onValueChange={setTypeFilter}
                  options={typeOptions}
                  placeholder="All Types"
                  searchPlaceholder="Search type..."
                  emptyText="No type found."
                  triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>

              {/* Status Filter */}
              <div className="min-w-[150px]">
                <Combobox
                  value={filterStatus}
                  onValueChange={setFilterStatus}
                  options={statusOptions}
                  placeholder="All Status"
                  searchPlaceholder="Search status..."
                  emptyText="No status found."
                  triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* Messages - Fixed at top with high z-index */}
        {success && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] w-full max-w-md mx-auto px-4 animate-fade-in">
            <div className="bg-[#10B981]/10 backdrop-blur-2xl border border-[#10B981]/20 rounded-xl p-4 flex items-start gap-3 ">
              <CheckCircle className="w-4 h-4 text-[#34D399] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-xs text-[#34D399] font-light">{success}</p>
              <button onClick={() => setSuccess('')} className="ml-auto text-[#34D399]/50 hover:text-[#34D399] transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] w-full max-w-md mx-auto px-4 animate-fade-in">
            <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4 flex items-start gap-3 ">
              <AlertCircle className="w-4 h-4 text-[#F87171] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-xs text-[#F87171] font-light">{error}</p>
              <button onClick={() => setError('')} className="ml-auto text-[#F87171]/50 hover:text-[#F87171] transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* Domain List or Group View */}
        {selectedGroup ? (
          /* Group Details View - Show domains in selected group */
          <div className="space-y-4">
            {/* Back button */}
            <button
              onClick={handleBackFromGroup}
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-xs"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              Back to all groups
            </button>

            {/* Group Header */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl"
                  style={{
                    backgroundColor: `${selectedGroup.color}15`,
                    borderColor: `${selectedGroup.color}30`,
                    border: '1px solid'
                  }}
                >
                  {selectedGroup.icon || '📁'}
                </div>
                <div>
                  <h2 className="text-xl font-light text-white mb-1">{selectedGroup.name}</h2>
                  <p className="text-xs text-white/50">{groupDomains.length} {groupDomains.length === 1 ? 'domain' : 'domains'}</p>
                </div>
              </div>
            </div>

            {/* Group Domains Table */}
            {loading ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-16 text-center">
                <Loader2 className="w-8 h-8 text-[#C77DFF] animate-spin mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-white/40 text-sm font-light">Loading domains...</p>
              </div>
            ) : groupDomains.length === 0 ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-16 text-center">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 flex items-center justify-center mx-auto mb-4">
                  <Folder className="w-8 h-8 text-white/30" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-medium text-white mb-2">No domains in this group</h3>
                <p className="text-sm text-white/50 font-light mb-6">Add domains to organize and manage them together</p>
                <button
                  onClick={() => handleOpenAddDomains(selectedGroup)}
                  className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.5} />
                  Add Domains to Group
                </button>
              </div>
            ) : (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden ">
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.08]">
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Domain</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Owner</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Type</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Backend</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Status</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">SSL</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Routing</th>
                        <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupDomains.map((domain) => (
                        <tr
                          key={domain.id}
                          onClick={() => navigate(`/domains/${domain.id}`)}
                          className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all cursor-pointer"
                        >
                          <td className="px-3 py-2">
                            <div>
                              <p className="text-xs font-normal text-white">{domain.hostname}</p>
                              {(domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft') && domain.external_port && (
                                <p className="text-xs text-[#C77DFF] font-light mt-0.5">Port: {domain.external_port}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {domain.ownership_type === 'team' && domain.team_name ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-xs font-medium tracking-wide border border-[#9D4EDD]/30">
                                <Users className="w-3 h-3" strokeWidth={1.5} />
                                {domain.team_name}
                              </span>
                            ) : (
                              <span className="text-xs text-white/60 font-light">Personal</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={domain.proxy_type === 'tcp' ? 'badge-warning' : domain.proxy_type === 'udp' ? 'badge-purple' : 'badge-success'}>
                              {domain.proxy_type === 'tcp' ? 'TCP' : domain.proxy_type === 'udp' ? 'UDP' : domain.proxy_type === 'minecraft' ? 'MINECRAFT' : 'HTTP'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <p className="text-xs text-white/60 font-mono font-light truncate max-w-[200px]">
                              {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft'
                                ? domain.backend_url?.replace(/^(tcp|udp|http|https):\/\//, '')
                                : domain.backend_url}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                              {domain.is_active ? 'Active' : 'Off'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft' ? (
                              <span className="text-white/30 text-xs">-</span>
                            ) : (
                              <span className={domain.ssl_enabled ? 'badge-success' : 'badge-purple'}>
                                {domain.ssl_enabled ? 'On' : 'Off'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft' ? (
                              <span className="text-white/30 text-xs">-</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                {routingChecks[domain.id]?.status === 'loading' ? (
                                  <Loader2 className="w-3.5 h-3.5 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
                                ) : routingChecks[domain.id]?.status === 'ok' ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-[#34D399]">
                                    <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    OK
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-[#F87171]">
                                    <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    {routingChecks[domain.id]?.message || 'Not linked'}
                                  </span>
                                )}
                                <button
                                  onClick={() => handleRoutingCheck(domain)}
                                  className="text-xs text-white/50 hover:text-[#C77DFF] transition-colors"
                                  title="Re-check routing"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              {domain.ssl_enabled && domain.acme_challenge_type === 'dns-01' && !domain.ssl_cert_path && (
                                <button
                                  onClick={() => handleRequestDNSCertificate(domain.id)}
                                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
                                  title="Get SSL Certificate"
                                >
                                  <Shield className="w-3 h-3" strokeWidth={1.5} />
                                  SSL
                                </button>
                              )}
                              <button
                                onClick={() => handleRemoveDomainFromGroup(domain.id)}
                                className="btn-secondary text-xs px-3 py-1.5"
                                title="Remove from group"
                              >
                                Ungroup
                              </button>
                              <button
                                onClick={() => handleDeleteDomain(domain)}
                                className="text-xs px-3 py-1.5 text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all"
                                title="Delete domain"
                              >
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden divide-y divide-white/[0.05]">
                  {groupDomains.map((domain) => (
                    <div
                      key={domain.id}
                      onClick={() => navigate(`/domains/${domain.id}`)}
                      className="p-3 hover:bg-white/[0.02] transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <p className="text-xs font-normal text-white mb-1">{domain.hostname}</p>
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            {domain.ownership_type === 'team' && domain.team_name ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-xs font-medium tracking-wide border border-[#9D4EDD]/30">
                                <Users className="w-3 h-3" strokeWidth={1.5} />
                                {domain.team_name}
                              </span>
                            ) : (
                              <span className="px-3 py-1 bg-white/[0.05] text-white/60 rounded-full text-xs font-light">Personal</span>
                            )}
                            <span className={domain.proxy_type === 'tcp' ? 'badge-warning' : domain.proxy_type === 'udp' ? 'badge-purple' : 'badge-success'}>
                              {domain.proxy_type === 'tcp' ? 'TCP' : domain.proxy_type === 'udp' ? 'UDP' : domain.proxy_type === 'minecraft' ? 'MINECRAFT' : 'HTTP'}
                            </span>
                            <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                              {domain.is_active ? 'Active' : 'Off'}
                            </span>
                            {domain.ssl_enabled && (!domain.proxy_type || domain.proxy_type === 'http') && (
                              <span className="badge-success">SSL</span>
                            )}
                            {(!domain.proxy_type || domain.proxy_type === 'http') && routingChecks[domain.id]?.status === 'ok' && (
                              <span className="badge-success">Routing OK</span>
                            )}
                            {(!domain.proxy_type || domain.proxy_type === 'http') && routingChecks[domain.id]?.status === 'fail' && (
                              <span className="badge-error">Routing Fail</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mb-2">
                        <p className="text-xs text-white/60 font-light uppercase tracking-wider mb-0.5">Backend</p>
                        <p className="text-xs text-white/60 font-mono font-light break-all">
                          {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft'
                            ? domain.backend_url?.replace(/^(tcp|udp|http|https):\/\//, '')
                            : domain.backend_url}
                        </p>
                      </div>
                      {domain.description && (
                        <div className="mb-2">
                          <p className="text-xs text-white/60 font-light uppercase tracking-wider mb-0.5">Description</p>
                          <p className="text-xs text-white/50">{domain.description}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleRemoveDomainFromGroup(domain.id)}
                          className="btn-secondary text-xs px-3 py-1.5"
                        >
                          Ungroup
                        </button>
                        <button
                          onClick={() => handleDeleteDomain(domain)}
                          className="text-xs px-3 py-1.5 text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden  animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
            </div>
          </div>
        ) : (
          /* Main View - Show groups and ungrouped domains */
          <div className="space-y-8">
            {/* Groups Section */}
            {filteredGroups.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#9D4EDD]/20 to-[#9D4EDD]/5 border border-[#9D4EDD]/30 flex items-center justify-center">
                    <Folder className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-white tracking-tight">Groups</h3>
                    <p className="text-xs text-white/50 font-light">{filteredGroups.length} group{filteredGroups.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredGroups.map((group, index) => (
                    <div
                      key={group.id}
                      className="group bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-lg p-3.5 hover:border-[#9D4EDD]/40 transition-all duration-200 cursor-pointer animate-fade-in"
                      style={{ animationDelay: `${index * 0.05}s` }}
                      onClick={() => handleGroupClick(group)}
                    >
                      <div className="flex items-center gap-2.5 mb-3">
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                          style={{
                            backgroundColor: `${group.color}15`
                          }}
                        >
                          {group.icon || '📁'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-white truncate group-hover:text-[#C77DFF] transition-colors">
                            {group.name}
                          </h3>
                          <p className="text-[9px] text-white/40 font-light truncate">
                            {group.ownership_type === 'personal' ? 'Personal' : group.team_name}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGroupRightClick(e, group);
                          }}
                          className="text-white/30 hover:text-white p-1 hover:bg-white/[0.08] rounded transition-all opacity-0 group-hover:opacity-100"
                          title="Options"
                        >
                          <MoreVertical className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>

                      {group.description && (
                        <p className="text-xs text-white/60 font-light mb-3 line-clamp-1">
                          {group.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.08]">
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-white/30" strokeWidth={1.5} />
                          <span className="text-xs text-white/60 font-light">
                            {group.domain_count || 0}
                          </span>
                        </div>
                        <GroupBadge group={group} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {filteredDomains.length === 0 && filteredGroups.length === 0 ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-12 text-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 flex items-center justify-center mx-auto mb-4">
                  {searchTerm ? (
                    <Search className="w-8 h-8 text-white/30" strokeWidth={1.5} />
                  ) : (
                    <Globe className="w-8 h-8 text-white/30" strokeWidth={1.5} />
                  )}
                </div>
                <h3 className="text-base font-medium text-white mb-2">
                  {searchTerm ? 'No results found' : 'No domains yet'}
                </h3>
                <p className="text-sm text-white/50 font-light max-w-md mx-auto mb-6">
                  {searchTerm
                    ? `No domains match "${searchTerm}". Try a different search or adjust your filters.`
                    : 'Get started by adding your first domain to manage proxies, SSL certificates, and more.'}
                </p>
                {!searchTerm && (
                  <button
                    onClick={() => setShowForm(true)}
                    disabled={!isUnlimited && quotaUsed >= quotaMax}
                    className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5"
                  >
                    <Plus className="w-4 h-4" strokeWidth={1.5} />
                    Add Your First Domain
                  </button>
                )}
              </div>
            ) : filteredDomains.length > 0 && (
              <div className="space-y-4">
                {/* Divider if there are groups above */}
                {filteredGroups.length > 0 && (
                  <div className="flex items-center gap-4 py-2">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#06B6D4]/20 to-[#06B6D4]/5 border border-[#06B6D4]/30 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-white tracking-tight">Ungrouped Domains</h3>
                    <p className="text-xs text-white/50 font-light">{filteredDomains.length} domain{filteredDomains.length !== 1 ? 's' : ''} without a group</p>
                  </div>
                </div>
                <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden animate-fade-in" style={{ animationDelay: '0.2s' }}>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-3">Domain</th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-3">Type</th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-3">Backend</th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-3">Status & SSL</th>
                    <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-3">Routing</th>
                    <th className="text-right text-xs uppercase tracking-wider text-white/60 font-medium px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedDomains.map((domain) => (
                    <tr
                      key={domain.id}
                      onClick={() => navigate(`/domains/${domain.id}`)}
                      className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium text-white">{domain.hostname}</p>
                            {domain.ownership_type === 'team' && domain.team_name && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-[9px] font-medium border border-[#9D4EDD]/30">
                                <Users className="w-2.5 h-2.5" strokeWidth={1.5} />
                                {domain.team_name}
                              </span>
                            )}
                          </div>
                          {(domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft') && domain.external_port && (
                            <p className="text-xs text-[#C77DFF] font-light">Port: {domain.external_port}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={domain.proxy_type === 'tcp' ? 'badge-warning' : domain.proxy_type === 'udp' ? 'badge-purple' : 'badge-success'}>
                          {domain.proxy_type === 'tcp' ? 'TCP' : domain.proxy_type === 'udp' ? 'UDP' : domain.proxy_type === 'minecraft' ? 'MINECRAFT' : 'HTTP'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-white/60 font-mono font-light truncate max-w-[250px]">
                          {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft'
                            ? domain.backend_url?.replace(/^(tcp|udp|http|https):\/\//, '')
                            : domain.backend_url}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                            {domain.is_active ? 'Active' : 'Off'}
                          </span>
                          {domain.proxy_type !== 'tcp' && domain.proxy_type !== 'udp' && domain.proxy_type !== 'minecraft' && domain.ssl_enabled && (
                            <span className="badge-success">
                              SSL
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft' ? (
                          <span className="text-white/30 text-xs">N/A</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            {routingChecks[domain.id]?.status === 'loading' ? (
                              <Loader2 className="w-3.5 h-3.5 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
                            ) : routingChecks[domain.id]?.status === 'ok' ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-[#34D399] font-medium">
                                <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
                                OK
                              </span>
                            ) : (
                              <button
                                onClick={() => handleRoutingCheck(domain)}
                                className="inline-flex items-center gap-1.5 text-xs text-[#F87171] hover:text-[#F87171]/80 transition-colors"
                                title="Click to check routing"
                              >
                                <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
                                Check
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenAddToGroup(domain)}
                            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                            title="Add to group"
                          >
                            <Folder className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                          {domain.ssl_enabled && domain.acme_challenge_type === 'dns-01' && !domain.ssl_cert_path && (
                            <button
                              onClick={() => handleRequestDNSCertificate(domain.id)}
                              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                              title="Get SSL Certificate"
                            >
                              <Shield className="w-3.5 h-3.5" strokeWidth={1.5} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteDomain(domain)}
                            className="text-xs px-3 py-1.5 text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all flex items-center gap-1.5"
                            title="Delete domain"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-white/[0.05]">
              {paginatedDomains.map((domain) => (
                <div
                  key={domain.id}
                  onClick={() => navigate(`/domains/${domain.id}`)}
                  className="p-3 hover:bg-white/[0.02] transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="text-xs font-normal text-white mb-1">{domain.hostname}</p>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {domain.ownership_type === 'team' && domain.team_name ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-xs font-medium tracking-wide border border-[#9D4EDD]/30">
                            <Users className="w-3 h-3" strokeWidth={1.5} />
                            {domain.team_name}
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-white/[0.05] text-white/60 rounded-full text-xs font-light">Personal</span>
                        )}
                        <span className={domain.proxy_type === 'tcp' ? 'badge-warning' : domain.proxy_type === 'udp' ? 'badge-purple' : 'badge-success'}>
                        {domain.proxy_type === 'tcp' ? 'TCP' : domain.proxy_type === 'udp' ? 'UDP' : domain.proxy_type === 'minecraft' ? 'MINECRAFT' : 'HTTP'}
                        </span>
                        <span className={domain.is_active ? 'badge-success' : 'badge-purple'}>
                          {domain.is_active ? 'Active' : 'Off'}
                        </span>
                        {domain.ssl_enabled && (!domain.proxy_type || domain.proxy_type === 'http') && (
                          <span className="badge-success">SSL</span>
                        )}
                        {(!domain.proxy_type || domain.proxy_type === 'http') && routingChecks[domain.id]?.status === 'ok' && (
                          <span className="badge-success">Routing OK</span>
                        )}
                        {(!domain.proxy_type || domain.proxy_type === 'http') && routingChecks[domain.id]?.status === 'fail' && (
                          <span className="badge-error">Routing Fail</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mb-2">
                    <p className="text-xs text-white/60 font-light uppercase tracking-wider mb-0.5">Backend</p>
                    <p className="text-xs text-white/60 font-mono font-light break-all">
                      {domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft'
                        ? domain.backend_url?.replace(/^(tcp|udp|http|https):\/\//, '')
                        : domain.backend_url}
                    </p>
                  </div>
                  {domain.description && (
                    <div className="mb-2">
                      <p className="text-xs text-white/60 font-light uppercase tracking-wider mb-0.5">Description</p>
                      <p className="text-xs text-white/50">{domain.description}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleOpenAddToGroup(domain)}
                      className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                      title="Add to group"
                    >
                      <Folder className="w-3 h-3" strokeWidth={1.5} />
                      Group
                    </button>
                    <button onClick={() => handleDeleteDomain(domain)} className="text-xs px-3 py-1.5 text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all">Delete</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-white/[0.08] flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-xs text-white/50 font-light">
                  Showing <span className="text-white font-medium">{startIndex + 1}-{Math.min(endIndex, filteredDomains.length)}</span> of <span className="text-white font-medium">{filteredDomains.length}</span> domains
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="btn-secondary text-xs px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <div className="flex gap-1.5">
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let page;
                      if (totalPages <= 5) {
                        page = i + 1;
                      } else if (currentPage <= 3) {
                        page = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        page = totalPages - 4 + i;
                      } else {
                        page = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={currentPage === page ? 'btn-primary text-xs px-3.5 py-2 min-w-[36px]' : 'btn-secondary text-xs px-3.5 py-2 min-w-[36px]'}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="btn-secondary text-xs px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <DomainForm
          domain={editingDomain}
          onSubmit={editingDomain ? handleEditDomain : handleAddDomain}
          onClose={closeForm}
          isLoading={submitting}
        />
      )}

      {/* DNS Challenge Modal */}
      {showDNSModal && (
        <div
          className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-[250] p-4"
          onClick={handleCloseDNSModal}
        >
          <div
            className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-3xl w-full p-6  max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">
              Configuration DNS Requise
            </h2>
            <p className="text-xs text-white/50 mb-5 font-light">
              Créez un enregistrement DNS TXT pour vérifier la propriété du domaine
            </p>

            {dnsError && (
              <div className="bg-[#EF4444]/10 backdrop-blur-lg border border-[#EF4444]/20 rounded-xl p-4 mb-5">
                <p className="text-xs text-[#F87171]">{dnsError}</p>
              </div>
            )}

            {dnsChallenge ? (
              <>
                {/* Instructions Card */}
                <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-xl p-5 mb-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#22D3EE] mb-1">
                        Étapes à suivre
                      </p>
                      <p className="text-xs text-white/70 font-light leading-relaxed">
                        Suivez ces étapes pour obtenir votre certificat SSL :
                      </p>
                    </div>
                  </div>

                  <ol className="space-y-3 ml-13">
                    {dnsChallenge.instructions?.map((instruction, index) => (
                      <li key={index} className="text-xs text-white/70 font-light leading-relaxed">
                        {instruction}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* DNS Record Details */}
                <div className="space-y-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">
                      Nom de l'enregistrement TXT
                    </label>
                    <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 flex items-center justify-between">
                      <code className="text-xs text-white/90 font-mono">
                        {dnsChallenge.txtRecord}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(dnsChallenge.txtRecord)}
                        className="text-[#C77DFF] hover:text-[#9D4EDD] text-xs ml-3 transition-colors duration-300"
                      >
                        Copier
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">
                      Valeur de l'enregistrement TXT
                    </label>
                    <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 flex items-center justify-between">
                      <code className="text-xs text-white/90 font-mono break-all">
                        {dnsChallenge.txtValue}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(dnsChallenge.txtValue)}
                        className="text-[#C77DFF] hover:text-[#9D4EDD] text-xs ml-3 flex-shrink-0 transition-colors duration-300"
                      >
                        Copier
                      </button>
                    </div>
                  </div>
                </div>

                {/* Propagation Status */}
                {dnsPropagated && (
                  <div className="bg-[#10B981]/10 backdrop-blur-lg border border-[#10B981]/20 rounded-xl p-4 mb-5">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                      <p className="text-xs text-[#34D399] font-medium">
                        Enregistrement DNS trouvé ! Prêt à valider.
                      </p>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={handleCloseDNSModal}
                    className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-6 py-3.5 font-light text-sm transition-all duration-500 ease-out active:scale-[0.98] flex-1"
                    disabled={dnsValidating || dnsCheckingPropagation}
                  >
                    Annuler
                  </button>

                  <button
                    onClick={handleCheckDNSPropagation}
                    className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-6 py-3.5 font-light text-sm transition-all duration-500 ease-out active:scale-[0.98] flex-1 flex items-center justify-center gap-2"
                    disabled={dnsCheckingPropagation || dnsValidating}
                  >
                    {dnsCheckingPropagation ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                        Vérification...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Vérifier DNS
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleValidateDNS}
                    className="bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white font-medium text-sm tracking-wide hover:from-[#C77DFF] hover:to-[#9D4EDD] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-6 py-4  transition-all duration-500 ease-out flex-1 flex items-center justify-center gap-2"
                    disabled={dnsValidating || dnsCheckingPropagation}
                  >
                    {dnsValidating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                        Validation...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Valider & Terminer
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <RefreshCw className="w-8 h-8 text-[#C77DFF] animate-spin mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-xs text-white/60">Initiation du challenge DNS...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowCreateGroupModal(false)}>
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-lg w-full p-6 " onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-4 tracking-tight">Create New Group</h2>

            <div className="space-y-4">
              {/* Type Selection */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateGroupForm({ ...createGroupForm, type: 'personal', teamId: null })}
                    className={createGroupForm.type === 'personal' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateGroupForm({ ...createGroupForm, type: 'team' })}
                    className={createGroupForm.type === 'team' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}
                  >
                    Team
                  </button>
                </div>
              </div>

              {/* Team Selection */}
              {createGroupForm.type === 'team' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Team</label>
                  <Combobox
                    value={createGroupForm.teamId ? createGroupForm.teamId.toString() : ''}
                    onValueChange={(selectedValue) =>
                      setCreateGroupForm({
                        ...createGroupForm,
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
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Name</label>
                <input
                  type="text"
                  value={createGroupForm.name}
                  onChange={(e) => setCreateGroupForm({ ...createGroupForm, name: e.target.value })}
                  className="input-futuristic text-xs"
                  placeholder="My Group"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Description</label>
                <textarea
                  value={createGroupForm.description}
                  onChange={(e) => setCreateGroupForm({ ...createGroupForm, description: e.target.value })}
                  className="input-futuristic text-xs min-h-[60px]"
                  placeholder="Optional description..."
                />
              </div>

              {/* Icon */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Icon</label>
                <input
                  type="text"
                  value={createGroupForm.icon}
                  onChange={(e) => setCreateGroupForm({ ...createGroupForm, icon: e.target.value })}
                  className="input-futuristic text-xs"
                  placeholder="📁"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Color</label>
                <input
                  type="color"
                  value={createGroupForm.color}
                  onChange={(e) => setCreateGroupForm({ ...createGroupForm, color: e.target.value })}
                  className="w-full h-10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => setShowCreateGroupModal(false)}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateGroup}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                  disabled={!createGroupForm.name || (createGroupForm.type === 'team' && !createGroupForm.teamId)}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.show && (
        <div
          className="fixed z-[300] bg-[#161722]/95 backdrop-blur-xl border border-white/[0.08] rounded-lg  overflow-hidden"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleOpenAddDomains}
            className="w-full px-4 py-2.5 text-left text-xs text-white/90 hover:bg-white/[0.05] flex items-center gap-2 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
            Add Domains
          </button>
          <button
            onClick={handleOpenEditGroup}
            className="w-full px-4 py-2.5 text-left text-xs text-white/90 hover:bg-white/[0.05] flex items-center gap-2 transition-colors"
          >
            <Edit className="w-3.5 h-3.5" strokeWidth={1.5} />
            Edit Group
          </button>
          <button
            onClick={handleDeleteGroup}
            className="w-full px-4 py-2.5 text-left text-xs text-[#F87171] hover:bg-[#EF4444]/10 flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Delete Group
          </button>
        </div>
      )}

      {/* Add Domains Modal */}
      {showAddDomainsModal && selectedGroupForDomains && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowAddDomainsModal(false)}>
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-2xl w-full p-6  max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">Add Domains to {selectedGroupForDomains.name}</h2>
            <p className="text-xs text-white/50 mb-5 font-light">
              Select domains to add to this group. Only ungrouped domains are shown.
            </p>

            {availableDomains.length === 0 ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-8 text-center">
                <p className="text-white/40 text-sm font-light">No ungrouped domains available</p>
              </div>
            ) : (
              <div className="space-y-2 mb-5">
                {availableDomains.map(domain => (
                  <label
                    key={domain.id}
                    className="flex items-center gap-3 p-3 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] rounded-lg cursor-pointer transition-all"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDomainIds.includes(domain.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDomainIds([...selectedDomainIds, domain.id]);
                        } else {
                          setSelectedDomainIds(selectedDomainIds.filter(id => id !== domain.id));
                        }
                      }}
                      className="w-4 h-4 rounded border-white/[0.2] text-[#9D4EDD] focus:ring-[#9D4EDD] focus:ring-offset-0"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-white font-light">{domain.hostname}</p>
                      {domain.ownership_type === 'team' && domain.team_name && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-xs font-medium mt-1">
                          <Users className="w-3 h-3" strokeWidth={1.5} />
                          {domain.team_name}
                        </span>
                      )}
                    </div>
                    <span className={domain.proxy_type === 'tcp' ? 'badge-warning' : domain.proxy_type === 'udp' ? 'badge-purple' : 'badge-success'}>
                      {domain.proxy_type === 'tcp' ? 'TCP' : domain.proxy_type === 'udp' ? 'UDP' : domain.proxy_type === 'minecraft' ? 'MINECRAFT' : 'HTTP'}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => setShowAddDomainsModal(false)}
                className="btn-secondary flex-1 text-xs px-4 py-2.5"
                disabled={addingDomains}
              >
                Cancel
              </button>
              <button
                onClick={handleAddDomainsToGroup}
                className="btn-primary flex-1 text-xs px-4 py-2.5"
                disabled={selectedDomainIds.length === 0 || addingDomains}
              >
                {addingDomains ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                    Adding...
                  </span>
                ) : (
                  `Add ${selectedDomainIds.length} domain${selectedDomainIds.length !== 1 ? 's' : ''}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {showEditGroupModal && editingGroup && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => { setShowEditGroupModal(false); setEditingGroup(null); }}>
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-lg w-full p-6 " onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-4 tracking-tight">Edit Group</h2>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Name</label>
                <input
                  type="text"
                  value={editGroupForm.name}
                  onChange={(e) => setEditGroupForm({ ...editGroupForm, name: e.target.value })}
                  className="input-futuristic text-xs"
                  placeholder="My Group"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Description</label>
                <textarea
                  value={editGroupForm.description}
                  onChange={(e) => setEditGroupForm({ ...editGroupForm, description: e.target.value })}
                  className="input-futuristic text-xs min-h-[60px]"
                  placeholder="Optional description..."
                />
              </div>

              {/* Icon */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Icon</label>
                <input
                  type="text"
                  value={editGroupForm.icon}
                  onChange={(e) => setEditGroupForm({ ...editGroupForm, icon: e.target.value })}
                  className="input-futuristic text-xs"
                  placeholder="📁"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Color</label>
                <input
                  type="color"
                  value={editGroupForm.color}
                  onChange={(e) => setEditGroupForm({ ...editGroupForm, color: e.target.value })}
                  className="w-full h-10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => { setShowEditGroupModal(false); setEditingGroup(null); }}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditGroup}
                  className="btn-primary flex-1 text-xs px-4 py-2.5"
                  disabled={!editGroupForm.name}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add to Group Modal */}
      {showAddToGroupModal && selectedDomainForGroup && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => setShowAddToGroupModal(false)}>
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-lg w-full p-6 " onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">Add to Group</h2>
            <p className="text-xs text-white/50 mb-5 font-light">
              Select a group for {selectedDomainForGroup.hostname}
            </p>

            {groups.length === 0 ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-8 text-center mb-5">
                <p className="text-white/40 text-sm font-light">No groups available. Create a group first.</p>
              </div>
            ) : (
              <div className="space-y-2 mb-5 max-h-[400px] overflow-y-auto">
                {groups.map(group => {
                  // Filter groups based on domain and group compatibility
                  const isTeamGroup = group.ownership_type === 'team';
                  const isPersonalDomain = selectedDomainForGroup.ownership_type === 'personal';
                  const isSameTeam = selectedDomainForGroup.team_id === group.team_id;

                  // Team groups can only have personal domains or same team domains
                  if (isTeamGroup && !isPersonalDomain && !isSameTeam) {
                    return null;
                  }

                  return (
                    <label
                      key={group.id}
                      className="flex items-center gap-3 p-3 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] rounded-lg cursor-pointer transition-all"
                    >
                      <input
                        type="radio"
                        name="group"
                        checked={selectedGroupId === group.id}
                        onChange={() => setSelectedGroupId(group.id)}
                        className="w-4 h-4 text-[#9D4EDD] focus:ring-[#9D4EDD] focus:ring-offset-0"
                      />
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                        style={{
                          backgroundColor: `${group.color}15`,
                          borderColor: `${group.color}30`,
                          border: '1px solid'
                        }}
                      >
                        {group.icon || '📁'}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white font-light">{group.name}</p>
                        <p className="text-xs text-white/60 font-light capitalize">
                          {group.ownership_type === 'personal' ? 'Personal' : group.team_name}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => setShowAddToGroupModal(false)}
                className="btn-secondary flex-1 text-xs px-4 py-2.5"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDomainToGroup}
                className="btn-primary flex-1 text-xs px-4 py-2.5"
                disabled={!selectedGroupId}
              >
                Add to Group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
