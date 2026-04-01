import { api } from './instance';

export const apiKeysAPI = {
  list: () => api.get('/api-keys'),
  get: (id) => api.get(`/api-keys/${id}`),
  create: (data) => api.post('/api-keys', data),
  update: (id, data) => api.put(`/api-keys/${id}`, data),
  delete: (id) => api.delete(`/api-keys/${id}`),
  getUsage: (id, days = 7) => api.get(`/api-keys/${id}/usage`, { params: { days } }),
  getAvailableScopes: () => api.get('/api-keys/scopes/available')
};
