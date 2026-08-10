import { api } from './instance';

export const socks5ProxyAPI = {
  getAll: () => api.get('/socks5-proxy'),
  create: (data) => api.post('/socks5-proxy', data),
  update: (id, data) => api.patch(`/socks5-proxy/${id}`, data),
  rotatePassword: (id) => api.post(`/socks5-proxy/${id}/rotate-password`),
  delete: (id) => api.delete(`/socks5-proxy/${id}`)
};
