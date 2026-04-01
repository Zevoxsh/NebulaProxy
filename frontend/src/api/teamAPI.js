import { api } from './instance';

export const teamAPI = {
  list: () => api.get('/teams'),
  get: (id) => api.get(`/teams/${id}`),
  create: (data) => api.post('/teams', data),
  update: (id, data) => api.put(`/teams/${id}`, data),
  delete: (id) => api.delete(`/teams/${id}`),

  // Team members
  getMembers: (id) => api.get(`/teams/${id}/members`),
  addMember: (id, username, permissions) => api.post(`/teams/${id}/members`, { username, permissions }),
  removeMember: (id, memberId) => api.delete(`/teams/${id}/members/${memberId}`),
  updateMemberPermissions: (id, memberId, permissions) => api.put(`/teams/${id}/members/${memberId}/permissions`, { permissions }),

  // Team domains
  getDomains: (id) => api.get(`/teams/${id}/domains`),
  assignDomain: (id, domainId) => api.post(`/teams/${id}/domains/${domainId}`),
  removeDomain: (id, domainId) => api.delete(`/teams/${id}/domains/${domainId}`),

  // Team invitations
  sendInvitation: (id, username, permissions) => api.post(`/teams/${id}/invitations`, { username, permissions }),
  getInvitations: (id) => api.get(`/teams/${id}/invitations`),
  cancelInvitation: (id, invitationId) => api.delete(`/teams/${id}/invitations/${invitationId}`),
  getMyInvitations: () => api.get('/teams/invitations/me'),
  getMyInvitationsCount: () => api.get('/teams/invitations/me/count'),
  acceptInvitation: (invitationId) => api.post(`/teams/invitations/${invitationId}/accept`),
  rejectInvitation: (invitationId) => api.post(`/teams/invitations/${invitationId}/reject`),

  // Team notification settings
  getNotificationSettings: (id) => api.get(`/teams/${id}/notifications`),
  updateNotificationSettings: (id, data) => api.put(`/teams/${id}/notifications`, data),
  testNotification: (id) => api.post(`/teams/${id}/notifications/test`),

  // Team logo
  uploadLogo: (id, formData) => api.post(`/teams/${id}/logo`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteLogo: (id) => api.delete(`/teams/${id}/logo`)
};
