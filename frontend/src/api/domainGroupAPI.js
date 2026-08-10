import { api } from './instance';

export const domainGroupAPI = {
  // Get all accessible groups
  list: () => api.get('/domain-groups'),

  // Get specific group with domains
  get: (id) => api.get(`/domain-groups/${id}`),

  // Create new group
  create: (data) => api.post('/domain-groups', data),

  // Update group
  update: (id, data) => api.put(`/domain-groups/${id}`, data),

  // Delete group
  delete: (id) => api.delete(`/domain-groups/${id}`),

  // Assign domain to group
  assignDomain: (groupId, domainId) => api.post(`/domain-groups/${groupId}/domains/${domainId}`),

  // Remove domain from group
  removeDomain: (groupId, domainId) => api.delete(`/domain-groups/${groupId}/domains/${domainId}`),

  // Bulk assign domains
  bulkAssignDomains: (groupId, domainIds) => api.post(`/domain-groups/${groupId}/domains/bulk`, { domainIds }),

  // Get group members
  getMembers: (groupId) => api.get(`/domain-groups/${groupId}/members`),

  // Add member to group
  addMember: (groupId, userId, permissions) => api.post(`/domain-groups/${groupId}/members`, { userId, permissions }),

  // Update member permissions
  updateMemberPermissions: (groupId, memberId, permissions) => api.put(`/domain-groups/${groupId}/members/${memberId}/permissions`, { permissions }),

  // Remove member from group
  removeMember: (groupId, memberId) => api.delete(`/domain-groups/${groupId}/members/${memberId}`)
};
