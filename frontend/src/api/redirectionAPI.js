import { api } from './instance';

export const redirectionAPI = {
  list: () => api.get('/redirections'),
  get: (id) => api.get(`/redirections/${id}`),
  create: (data) => api.post('/redirections', data),
  update: (id, data) => api.put(`/redirections/${id}`, data),
  delete: (id) => api.delete(`/redirections/${id}`),
  toggle: (id) => api.post(`/redirections/${id}/toggle`),
  getStats: (id) => api.get(`/redirections/${id}/stats`)
};
