import { api } from './instance';

export const tunnelsAPI = {
  getAll: () => api.get('/tunnels'),
  create: (data) => api.post('/tunnels', data),
  getOne: (id) => api.get(`/tunnels/${id}`),
  generateCode: (id, data) => api.post(`/tunnels/${id}/enrollment-code`, data),
  enroll: (data) => api.post('/tunnels/enroll', data),
  getBindings: (id) => api.get(`/tunnels/${id}/bindings`),
  createBinding: (id, data) => api.post(`/tunnels/${id}/bindings`, data),
  deleteBinding: (tunnelId, bindingId) => api.delete(`/tunnels/${tunnelId}/bindings/${bindingId}`),
  getAccess: (id) => api.get(`/tunnels/${id}/access`),
  grantAccess: (id, data) => api.post(`/tunnels/${id}/access`, data),
  revokeAccess: (id, userId) => api.delete(`/tunnels/${id}/access/${userId}`)
};
