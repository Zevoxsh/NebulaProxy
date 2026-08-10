import { api } from './instance';

export const wireguardAPI = {
  getAll: () => api.get('/admin/wireguard'),
  get: (id) => api.get(`/admin/wireguard/${id}`),
  create: (data) => api.post('/admin/wireguard', data),
  update: (id, data) => api.patch(`/admin/wireguard/${id}`, data),
  enable: (id) => api.post(`/admin/wireguard/${id}/enable`),
  disable: (id) => api.post(`/admin/wireguard/${id}/disable`),
  rotateKeys: (id) => api.post(`/admin/wireguard/${id}/rotate-keys`),
  delete: (id) => api.delete(`/admin/wireguard/${id}`),
  downloadConfig: (id) => api.get(`/admin/wireguard/${id}/config`, { responseType: 'blob' }),

  addPeer: (tunnelId, data) => api.post(`/admin/wireguard/${tunnelId}/peers`, data),
  updatePeer: (tunnelId, peerId, data) => api.patch(`/admin/wireguard/${tunnelId}/peers/${peerId}`, data),
  deletePeer: (tunnelId, peerId) => api.delete(`/admin/wireguard/${tunnelId}/peers/${peerId}`)
};
