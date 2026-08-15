import { api } from './instance';

export const ipsecAPI = {
  getAll: () => api.get('/admin/ipsec'),
  get: (id) => api.get(`/admin/ipsec/${id}`),
  create: (data) => api.post('/admin/ipsec', data),
  update: (id, data) => api.patch(`/admin/ipsec/${id}`, data),
  enable: (id) => api.post(`/admin/ipsec/${id}/enable`),
  disable: (id) => api.post(`/admin/ipsec/${id}/disable`),
  rotatePsk: (id, psk) => api.post(`/admin/ipsec/${id}/rotate-psk`, psk ? { psk } : undefined),
  getPsk: (id) => api.get(`/admin/ipsec/${id}/psk`),
  delete: (id) => api.delete(`/admin/ipsec/${id}`),
  downloadConfig: (id) => api.get(`/admin/ipsec/${id}/config`, { responseType: 'blob' })
};
